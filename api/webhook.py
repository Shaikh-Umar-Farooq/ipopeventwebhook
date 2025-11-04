"""
Razorpay Webhook Handler for Vercel
File: api/webhook.py

Deploy Instructions:
1. Install dependencies: pip install -r requirements.txt
2. Create .env file with all credentials (see .env.example)
3. Set environment variables in Vercel dashboard
4. Deploy to Vercel: vercel --prod
5. Configure webhook URL in Razorpay: https://your-domain.vercel.app/api/webhook
"""

from http.server import BaseHTTPRequestHandler
import json
import mysql.connector
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
import qrcode
from io import BytesIO
import base64
from datetime import datetime
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
import hashlib
import hmac
import os

# Load environment variables
DB_HOST = os.getenv('DB_HOST')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME')

EMAIL_ADDRESS = os.getenv('EMAIL_ADDRESS')
APP_PASSWORD = os.getenv('APP_PASSWORD')

ENCRYPTION_KEY = os.getenv('ENCRYPTION_KEY', 'default_key_change_this_32chars')[:32].ljust(32, '0')
ENCRYPTION_IV = os.getenv('ENCRYPTION_IV', 'default_iv_16ch')[:16].ljust(16, '0')

TARGET_PAGE_ID = os.getenv('TARGET_PAGE_ID')
RAZORPAY_WEBHOOK_SECRET = os.getenv('RAZORPAY_WEBHOOK_SECRET', '')

# Database Configuration
DB_CONFIG = {
    'host': DB_HOST,
    'user': DB_USER,
    'password': DB_PASSWORD,
    'database': DB_NAME
}

def encrypt_data(data):
    """Encrypt data using AES-256-CBC"""
    key = ENCRYPTION_KEY.encode('utf-8')
    iv = ENCRYPTION_IV.encode('utf-8')
    
    cipher = AES.new(key, AES.MODE_CBC, iv)
    json_string = json.dumps(data)
    padded_data = pad(json_string.encode('utf-8'), AES.block_size)
    encrypted = cipher.encrypt(padded_data)
    
    return encrypted.hex()

def generate_qr_code(ticket_id, email):
    """Generate QR code with encrypted ticket data"""
    payload = {
        'ticket_id': ticket_id,
        'email': email,
        'ts': str(int(datetime.now().timestamp() * 1000))
    }
    
    encrypted_data = encrypt_data(payload)
    
    # Generate QR code
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(encrypted_data)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Convert to bytes
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    return buffered.getvalue()

def send_email_with_qr(to_email, name, ticket_id, qr_image_bytes, item_purchased, amount_paid):
    """Send email with QR code attachment"""
    try:
        msg = MIMEMultipart()
        msg['From'] = EMAIL_ADDRESS
        msg['To'] = to_email
        msg['Subject'] = f'Your Ticket Confirmation - {ticket_id}'
        
        # Email body
        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #2c3e50;">Thank You for Your Purchase!</h2>
            <p>Dear {name},</p>
            <p>Your ticket has been confirmed. Here are your details:</p>
            
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Ticket ID:</strong> {ticket_id}</p>
                <p><strong>Item:</strong> {item_purchased}</p>
                <p><strong>Amount Paid:</strong> ₹{amount_paid}</p>
                <p><strong>Date:</strong> {datetime.now().strftime('%B %d, %Y at %I:%M %p')}</p>
            </div>
            
            <p>Please find your QR code ticket attached to this email. Show this QR code at the venue for entry.</p>
            
            <p style="margin-top: 30px;">Best regards,<br>The Team</p>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(body, 'html'))
        
        # Attach QR code
        qr_attachment = MIMEBase('application', 'octet-stream')
        qr_attachment.set_payload(qr_image_bytes)
        encoders.encode_base64(qr_attachment)
        qr_attachment.add_header('Content-Disposition', f'attachment; filename=ticket_{ticket_id}.png')
        msg.attach(qr_attachment)
        
        # Send email
        with smtplib.SMTP('smtp.gmail.com', 587) as server:
            server.starttls()
            server.login(EMAIL_ADDRESS, APP_PASSWORD)
            server.send_message(msg)
        
        return True
    except Exception as e:
        print(f"Error sending email: {e}")
        return False

def verify_razorpay_signature(webhook_secret, payload, signature):
    """Verify Razorpay webhook signature"""
    if not webhook_secret:
        return True  # Skip verification if no secret is set
    
    expected_signature = hmac.new(
        webhook_secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected_signature, signature)

def save_to_database(payment_data):
    """Save payment data to MySQL database"""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        insert_query = """
        INSERT INTO ipop_ticket_details 
        (payment_id, order_id, name, email, phone_number, item_purchased, amount_paid, purchase_date, ticket_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        
        cursor.execute(insert_query, (
            payment_data['payment_id'],
            payment_data['order_id'],
            payment_data['name'],
            payment_data['email'],
            payment_data['phone_number'],
            payment_data['item_purchased'],
            payment_data['amount_paid'],
            payment_data['purchase_date'],
            payment_data['ticket_id']
        ))
        
        conn.commit()
        cursor.close()
        conn.close()
        return True
    except Exception as e:
        print(f"Database error: {e}")
        return False

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        """Handle webhook POST request"""
        try:
            # Read request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            webhook_body = post_data.decode('utf-8')
            
            # Parse JSON
            webhook_data = json.loads(webhook_body)
            
            # Get signature for verification
            signature = self.headers.get('X-Razorpay-Signature', '')
            
            # Verify signature if secret is configured
            if RAZORPAY_WEBHOOK_SECRET and not verify_razorpay_signature(
                RAZORPAY_WEBHOOK_SECRET, webhook_body, signature
            ):
                self.send_response(401)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Invalid signature'}).encode('utf-8'))
                return
            
            # Check if it's a payment for our page
            event = webhook_data.get('event')
            payload = webhook_data.get('payload', {})
            payment = payload.get('payment', {}).get('entity', {})
            
            # Check if payment is for our page ID
            notes = payment.get('notes', {})
            page_id = notes.get('page_id', '')
            
            if page_id != TARGET_PAGE_ID:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'Payment not for target page')
                return
            
            # Extract payment details
            payment_id = payment.get('id', 'N/A')
            order_id = payment.get('order_id', 'N/A')
            amount_paid = payment.get('amount', 0) / 100  # Convert paise to rupees
            email = payment.get('email', '')
            phone = payment.get('contact', '')
            
            # Get customer name from notes or payment details
            name = notes.get('name', payment.get('customer_name', 'Customer'))
            item_purchased = notes.get('item', 'Ticket')
            
            # Generate unique ticket ID
            ticket_id = f"TKT-{datetime.now().strftime('%Y%m%d')}-{payment_id[-8:]}"
            
            # Prepare payment data
            payment_data = {
                'payment_id': payment_id,
                'order_id': order_id,
                'name': name,
                'email': email,
                'phone_number': phone,
                'item_purchased': item_purchased,
                'amount_paid': amount_paid,
                'purchase_date': datetime.now(),
                'ticket_id': ticket_id
            }
            
            # Generate QR code
            qr_image = generate_qr_code(ticket_id, email)
            
            # Send email with QR code
            email_sent = send_email_with_qr(
                email, name, ticket_id, qr_image, 
                item_purchased, amount_paid
            )
            
            # Save to database
            db_saved = save_to_database(payment_data)
            
            # Send response
            response = {
                'success': True,
                'ticket_id': ticket_id,
                'email_sent': email_sent,
                'db_saved': db_saved
            }
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode('utf-8'))
            
        except Exception as e:
            print(f"Error processing webhook: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            error_response = {'success': False, 'error': str(e)}
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
    
    def do_GET(self):
        """Handle GET request - health check"""
        self.send_response(200)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'Razorpay Webhook Handler is running!')