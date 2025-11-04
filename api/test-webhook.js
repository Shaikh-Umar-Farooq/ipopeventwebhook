module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const testPayload = {
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'pl_RZdy0gwoRRyEDB',
            amount: 50000,
            currency: 'INR',
            description: 'iPOP Event Ticket',
            customer: {
              name: req.body.name || 'Test User',
              email: req.body.email || 'test@example.com',
              contact: req.body.phone || '+919876543210'
            }
          }
        },
        payment: {
          entity: {
            id: 'pay_TEST' + Math.random().toString(36).substr(2, 9),
            order_id: 'order_TEST' + Math.random().toString(36).substr(2, 9),
            amount: req.body.amount || 50000,
            currency: 'INR',
            status: 'captured',
            method: 'upi',
            created_at: Math.floor(Date.now() / 1000)
          }
        }
      }
    };
  
    try {
      const webhookModule = require('./razorpay-webhook');
      req.body = testPayload;
      req.headers['x-razorpay-signature'] = 'test_signature';
      
      return await webhookModule(req, res);
    } catch (error) {
      return res.status(500).json({ 
        error: 'Test failed',
        message: error.message 
      });
    }
  };