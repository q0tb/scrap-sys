// --- ES module-compatible imports ---
import express from 'express';
import cors from 'cors';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Support for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Begin your original code...
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Database setup
const dbPath = path.join(__dirname, 'db.json');

// Default database structure
const defaultData = {
  orders: [],
  config: {
    basePrice: 45,
    packaging: {
      basic: 3,
      branded: 5,
      box: 7
    },
    embroidery: 20
  },
  settings: {}
};

// Initialize database file if needed
function initializeDbFile() {
  let needsInit = false;
  
  try {
    if (!fs.existsSync(dbPath)) {
      needsInit = true;
    } else {
      const fileContent = fs.readFileSync(dbPath, 'utf-8').trim();
      if (fileContent.length === 0) {
        needsInit = true;
      } else {
        const data = JSON.parse(fileContent);
        if (typeof data !== 'object' || Array.isArray(data) || data === null) {
          needsInit = true;
        }
      }
    }
  } catch (error) {
    console.warn('Database file corrupted, reinitializing:', error.message);
    needsInit = true;
  }
  
  if (needsInit) {
    fs.writeFileSync(dbPath, JSON.stringify(defaultData, null, 2), 'utf-8');
    console.log('Database file initialized');
  }
}

// Initialize database
async function initDB() {
  initializeDbFile();
  
  const adapter = new JSONFile(dbPath);
  const db = new Low(adapter, defaultData); // Pass default data here
  
  await db.read();
  
  // Ensure all required properties exist with proper structure
  db.data = db.data || {};
  db.data.orders = db.data.orders || [];
  db.data.config = { ...defaultData.config, ...(db.data.config || {}) };
  db.data.settings = db.data.settings || {};
  
  // Ensure packaging object exists
  if (!db.data.config.packaging) {
    db.data.config.packaging = defaultData.config.packaging;
  }
  
  await db.write();
  return db;
}

// Validation functions
function validateOrderData(data) {
  const { customer, size, packaging } = data;
  
  if (!customer || typeof customer !== 'string' || customer.trim().length === 0) {
    return 'Customer name is required';
  }
  
  if (!size || !['M', 'L', 'XL', '2XL'].includes(size)) {
    return 'Valid size is required (M, L, XL, 2XL)';
  }
  
  if (!packaging || !['basic', 'branded', 'box'].includes(packaging)) {
    return 'Valid packaging type is required (basic, branded, box)';
  }
  
  return null;
}

function validateConfigData(data) {
  const { basePrice, packaging, embroidery } = data;
  
  if (basePrice !== undefined && (typeof basePrice !== 'number' || basePrice < 0)) {
    return 'Base price must be a positive number';
  }
  
  if (packaging) {
    const validPackageTypes = ['basic', 'branded', 'box'];
    for (const [type, price] of Object.entries(packaging)) {
      if (!validPackageTypes.includes(type) || typeof price !== 'number' || price < 0) {
        return 'Invalid packaging configuration';
      }
    }
  }
  
  if (embroidery !== undefined && (typeof embroidery !== 'number' || embroidery < 0)) {
    return 'Embroidery price must be a positive number';
  }
  
  return null;
}

// Price calculation function
function calculatePrice(config, size, packaging, embroidery) {
  let price = config.basePrice || 0;
  price += config.packaging[packaging] || 0;
  if (embroidery) {
    price += config.embroidery || 0;
  }
  return Math.round(price * 100) / 100; // Round to 2 decimal places
}

// Start server
async function startServer() {
  let db;
  
  try {
    db = await initDB();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }

  // Get all orders
  app.get('/api/orders', async (req, res) => {
    try {
      await db.read();
      res.json(db.data.orders || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  });

  // Add new order
  app.post('/api/orders', async (req, res) => {
    try {
      const validationError = validateOrderData(req.body);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      
      const { customer, size, packaging, embroidery } = req.body;
      
      await db.read();
      const config = db.data.config;
      const price = calculatePrice(config, size, packaging, embroidery);
      
      const newOrder = {
        id: uuidv4(),
        customer: customer.trim(),
        size,
        packaging,
        embroidery: !!embroidery,
        price,
        date: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString()
      };
      
      db.data.orders.push(newOrder);
      await db.write();
      
      res.status(201).json(newOrder);
    } catch (error) {
      console.error('Error creating order:', error);
      res.status(500).json({ error: 'Failed to create order' });
    }
  });

  // Get configuration
  app.get('/api/config', async (req, res) => {
    try {
      await db.read();
      const config = db.data.config;
      res.json({
        basePrice: config.basePrice,
        packaging: config.packaging,
        embroidery: config.embroidery
      });
    } catch (error) {
      console.error('Error fetching config:', error);
      res.status(500).json({ error: 'Failed to fetch configuration' });
    }
  });

  // Update configuration
  app.post('/api/config/update', async (req, res) => {
    try {
      const validationError = validateConfigData(req.body);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      
      const { basePrice, packaging, embroidery } = req.body;
      
      await db.read();
      
      if (basePrice !== undefined) {
        db.data.config.basePrice = basePrice;
      }
      
      if (packaging) {
        db.data.config.packaging = { ...db.data.config.packaging, ...packaging };
      }
      
      if (embroidery !== undefined) {
        db.data.config.embroidery = embroidery;
      }
      
      await db.write();
      res.json(db.data.config);
    } catch (error) {
      console.error('Error updating config:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });

  // Get settings
  app.get('/api/settings', async (req, res) => {
    try {
      await db.read();
      res.json(db.data.settings || {});
    } catch (error) {
      console.error('Error fetching settings:', error);
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  // Update settings
  app.put('/api/settings', async (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid settings data' });
      }
      
      console.log('Updating settings with:', req.body); // Debug log
      
      await db.read();
      
      // Ensure settings object exists
      if (!db.data.settings) {
        db.data.settings = {};
      }
      
      // Update settings
      db.data.settings = { ...db.data.settings, ...req.body };
      
      // Force write to disk
      await db.write();
      
      console.log('Settings updated successfully:', db.data.settings); // Debug log
      
      res.json({
        success: true,
        settings: db.data.settings
      });
    } catch (error) {
      console.error('Error updating settings:', error);
      res.status(500).json({ error: 'Failed to update settings', details: error.message });
    }
  });

  // Alternative POST endpoint for settings (in case frontend uses POST)
  app.post('/api/settings', async (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid settings data' });
      }
      
      console.log('Updating settings via POST with:', req.body); // Debug log
      
      await db.read();
      
      // Ensure settings object exists
      if (!db.data.settings) {
        db.data.settings = {};
      }
      
      // Update settings
      db.data.settings = { ...db.data.settings, ...req.body };
      
      // Force write to disk
      await db.write();
      
      console.log('Settings updated successfully via POST:', db.data.settings); // Debug log
      
      res.json({
        success: true,
        settings: db.data.settings
      });
    } catch (error) {
      console.error('Error updating settings via POST:', error);
      res.status(500).json({ error: 'Failed to update settings', details: error.message });
    }
  });

  // Get dashboard stats
  app.get('/api/stats', async (req, res) => {
    try {
      await db.read();
      const orders = db.data.orders || [];
      
      const stats = {
        totalOrders: orders.length,
        totalRevenue: orders.reduce((sum, order) => sum + (order.price || 0), 0),
        sizeBreakdown: {
          M: orders.filter(o => o.size === 'M').length,
          L: orders.filter(o => o.size === 'L').length,
          XL: orders.filter(o => o.size === 'XL').length,
          '2XL': orders.filter(o => o.size === '2XL').length
        },
        packagingBreakdown: {
          basic: orders.filter(o => o.packaging === 'basic').length,
          branded: orders.filter(o => o.packaging === 'branded').length,
          box: orders.filter(o => o.packaging === 'box').length
        },
        embroideryCount: orders.filter(o => o.embroidery).length,
        recentOrders: orders
          .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date))
          .slice(0, 5)
      };
      
      res.json(stats);
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch statistics' });
    }
  });

  // Delete order
  app.delete('/api/orders/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({ error: 'Order ID is required' });
      }
      
      await db.read();
      const orderIndex = db.data.orders.findIndex(order => order.id === id);
      
      if (orderIndex === -1) {
        return res.status(404).json({ error: 'Order not found' });
      }
      
      const deletedOrder = db.data.orders.splice(orderIndex, 1)[0];
      await db.write();
      
      res.json({ 
        message: 'Order deleted successfully',
        deletedOrder 
      });
    } catch (error) {
      console.error('Error deleting order:', error);
      res.status(500).json({ error: 'Failed to delete order' });
    }
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  // Serve frontend files
  app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: 'Frontend not found' });
    }
  });

  // Start server
  app.listen(PORT, () => {
    console.log(`ScrubU server running on port ${PORT}`);
    console.log(`Database file: ${dbPath}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down server...');
  process.exit(0);
});

// Start the server
startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
