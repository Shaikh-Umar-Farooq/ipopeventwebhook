// ===========================
// FILE: api/razorpay-webhook.js (Vercel Serverless Function)
// ===========================
// Supports multiple Razorpay webhook events:
// - payment_link.paid: For payments via Payment Links
// - payment.captured: For direct payment captures
// - order.paid: For payments via Razorpay Pages/Orders (most common for Pages)
// ===========================

const crypto = require('crypto');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

// Environment variables (set these in Vercel/Netlify dashboard)
const DB_CONFIG = {
  host: process.env.DB_HOST ,
  user: process.env.DB_USER ,
  password: process.env.DB_PASSWORD ,
  database: process.env.DB_NAME ,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const EMAIL_CONFIG = {
  user: process.env.EMAIL_ADDRESS ,
  pass: process.env.APP_PASSWORD 
};

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ;
const ENCRYPTION_IV = process.env.ENCRYPTION_IV ;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const TARGET_PAYMENT_LINK_ID = 'pl_RZdy0gwoRRyEDB';

// Encryption function
function encrypt(data) {
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const iv = Buffer.from(ENCRYPTION_IV.padEnd(16, '0').slice(0, 16));
  
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const jsonString = JSON.stringify(data);
  
  let encrypted = cipher.update(jsonString, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return encrypted;
}

// Generate QR Code
async function generateQRCode(ticketData) {
  const payload = {
    ticket_id: ticketData.ticket_id,
    email: ticketData.email,
    ts: Date.now().toString()
  };

  const encryptedData = encrypt(payload);
  
  // Generate QR code as base64
  const qrCodeDataUrl = await QRCode.toDataURL(encryptedData, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 500,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });

  return qrCodeDataUrl;
}

// Send email with QR code
async function sendTicketEmail(ticketData, qrCodeDataUrl) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_CONFIG.user,
      pass: EMAIL_CONFIG.pass
    }
  });

  const mailOptions = {
    from: `iPOP Event <${EMAIL_CONFIG.user}>`,
    to: ticketData.email,
    subject: `Your iPOP Event Ticket - ${ticketData.ticket_id}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .ticket-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
          .label { font-weight: bold; color: #667eea; }
          .qr-container { text-align: center; margin: 30px 0; }
          .qr-code { max-width: 300px; border: 4px solid #667eea; border-radius: 10px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          .important { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Your Ticket is Confirmed!</h1>
            <p>Thank you for your purchase</p>
          </div>
          <div class="content">
            <div class="ticket-info">
              <h2 style="color: #667eea; margin-top: 0;">Ticket Details</h2>
              <div class="info-row">
                <span class="label">Ticket ID:</span>
                <span>${ticketData.ticket_id}</span>
              </div>
              <div class="info-row">
                <span class="label">Name:</span>
                <span>${ticketData.name}</span>
              </div>
              <div class="info-row">
                <span class="label">Email:</span>
                <span>${ticketData.email}</span>
              </div>
              <div class="info-row">
                <span class="label">Phone:</span>
                <span>${ticketData.phone}</span>
              </div>
              <div class="info-row">
                <span class="label">Item:</span>
                <span>${ticketData.item_purchased}</span>
              </div>
              <div class="info-row">
                <span class="label">Amount Paid:</span>
                <span>₹${ticketData.prize_paid}</span>
              </div>
              <div class="info-row">
                <span class="label">Payment ID:</span>
                <span>${ticketData.payment_id}</span>
              </div>
              <div class="info-row">
                <span class="label">Date:</span>
                <span>${ticketData.date_purchased}</span>
              </div>
            </div>

            <div class="important">
              <strong>⚠️ Important:</strong> Please save this QR code. You'll need to show it at the event entrance.
            </div>

            <div class="qr-container">
              <h3 style="color: #667eea;">Your Entry QR Code</h3>
              <img src="${qrCodeDataUrl}" alt="Ticket QR Code" class="qr-code" />
              <p style="color: #666; margin-top: 10px;">Show this QR code at the venue</p>
            </div>

            <div class="footer">
              <p>If you have any questions, please contact us at ${EMAIL_CONFIG.user}</p>
              <p>© ${new Date().getFullYear()} iPOP Event. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
}

// Store in database
async function storeInDatabase(ticketData) {
  const connection = await mysql.createConnection(DB_CONFIG);
  
  try {
    const query = `
      INSERT INTO ipop_ticket_details 
      (ticket_id, payment_id, order_id, name, email, phone, item_purchased, prize_paid, date_purchased)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const values = [
      ticketData.ticket_id,
      ticketData.payment_id,
      ticketData.order_id,
      ticketData.name,
      ticketData.email,
      ticketData.phone,
      ticketData.item_purchased,
      ticketData.prize_paid,
      ticketData.date_purchased
    ];
    
    await connection.execute(query, values);
  } finally {
    await connection.end();
  }
}

// Verify Razorpay signature
function verifySignature(body, signature) {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    console.log('Warning: No webhook secret configured, skipping signature verification');
    return true;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
    
  return expectedSignature === signature;
}

// Main webhook handler
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-razorpay-signature');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ 
      status: 'ok', 
      message: 'Webhook endpoint is active',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const signature = req.headers['x-razorpay-signature'];
    
    // Verify signature
    if (!verifySignature(req.body, signature)) {
      console.error('Invalid signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { event, payload } = req.body;
    
    console.log('Webhook received:', event);

    let payment, customer, itemDescription, paymentLinkId;
    
    // Handle different event types for Razorpay Pages
    if (event === 'payment_link.paid') {
      // Payment Link based payment
      const paymentLink = payload.payment_link?.entity;
      
      if (!paymentLink) {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Invalid payment_link.paid payload' 
        });
      }
      
      // Check if it's our payment link (if payment link ID is specified)
      if (TARGET_PAYMENT_LINK_ID && paymentLink.id !== TARGET_PAYMENT_LINK_ID) {
        return res.status(200).json({ 
          status: 'ignored', 
          message: 'Different payment link ID' 
        });
      }
      
      payment = payload.payment?.entity;
      customer = paymentLink.customer;
      itemDescription = paymentLink.description || 'iPOP Event Ticket';
      paymentLinkId = paymentLink.id;
      
    } else if (event === 'payment.captured') {
      // Direct payment capture
      payment = payload.payment?.entity;
      
      if (!payment) {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Invalid payment.captured payload' 
        });
      }
      
      // Extract customer from payment notes or contact
      customer = {
        name: payment.notes?.name || payment.contact?.name || 'Customer',
        email: payment.email || payment.notes?.email || '',
        contact: payment.contact?.phone || payment.notes?.phone || ''
      };
      itemDescription = payment.notes?.description || 'iPOP Event Ticket';
      
    } else if (event === 'order.paid') {
      // Order based payment (common for Razorpay Pages)
      const order = payload.order?.entity;
      
      if (!order) {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Invalid order.paid payload' 
        });
      }
      
      // Get payment from order
      payment = payload.payment?.entity;
      customer = {
        name: order.notes?.name || order.customer_details?.name || 'Customer',
        email: order.customer_details?.email || order.notes?.email || '',
        contact: order.customer_details?.contact || order.notes?.phone || ''
      };
      itemDescription = order.notes?.description || order.notes?.item || 'iPOP Event Ticket';
      
    } else {
      // Log other events but don't process
      console.log(`Event ${event} received but not processed`);
      return res.status(200).json({ 
        status: 'ignored', 
        message: `Event ${event} not handled. Supported events: payment_link.paid, payment.captured, order.paid` 
      });
    }

    // Validate payment exists
    if (!payment || !payment.id) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Payment information not found in payload' 
      });
    }

    // Generate ticket ID
    const ticketId = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    
    // Prepare ticket data
    const ticketData = {
      ticket_id: ticketId,
      payment_id: payment.id,
      order_id: payment.order_id || payment.id,
      name: customer?.name || 'Customer',
      email: customer?.email || '',
      phone: customer?.contact || '',
      item_purchased: itemDescription,
      prize_paid: (payment.amount / 100).toFixed(2), // Convert paise to rupees
      date_purchased: new Date(payment.created_at * 1000).toISOString().split('T')[0]
    };

    console.log(`Processing ticket for event ${event}:`, ticketId);

    // Generate QR code
    const qrCodeDataUrl = await generateQRCode(ticketData);
    console.log('QR code generated');

    // Store in database
    await storeInDatabase(ticketData);
    console.log('Data stored in database');

    // Send email
    if (ticketData.email) {
      await sendTicketEmail(ticketData, qrCodeDataUrl);
      console.log('Email sent to:', ticketData.email);
    } else {
      console.warn('No email address found, skipping email send');
    }

    return res.status(200).json({ 
      status: 'success',
      message: 'Ticket processed successfully',
      ticket_id: ticketId
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};