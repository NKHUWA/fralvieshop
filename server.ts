import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";

const app = express();
const PORT = 3000;
const db = new Database("inventory.db");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Middleware to check admin password
const checkAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const password = req.headers['x-admin-password'];
  if (password === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized: Invalid admin password" });
  }
};

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    price REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    quantity INTEGER,
    total_price REAL,
    sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(item_id) REFERENCES items(id)
  );
`);

app.use(express.json());

// API Routes
app.get("/api/items", (req, res) => {
  const items = db.prepare("SELECT * FROM items ORDER BY name ASC").all();
  res.json(items);
});

app.post("/api/items", (req, res) => {
  const { barcode, name, category, price, stock } = req.body;
  try {
    const info = db.prepare(
      "INSERT INTO items (barcode, name, category, price, stock) VALUES (?, ?, ?, ?, ?)"
    ).run(barcode, name, category, price, stock);
    res.json({ id: info.lastInsertRowid });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/items/:id", (req, res) => {
  const { name, category, price, stock } = req.body;
  const { id } = req.params;
  db.prepare(
    "UPDATE items SET name = ?, category = ?, price = ?, stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(name, category, price, stock, id);
  res.json({ success: true });
});

app.delete("/api/items/:id", (req, res) => {
  const { id } = req.params;
  try {
    db.prepare("DELETE FROM items WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/sales", (req, res) => {
  const sales = db.prepare(`
    SELECT 
      sales.id,
      items.name as item_name,
      items.barcode,
      sales.quantity,
      sales.total_price,
      sales.sale_date
    FROM sales
    JOIN items ON sales.item_id = items.id
    ORDER BY sales.sale_date DESC
  `).all();
  res.json(sales);
});

app.post("/api/sales", (req, res) => {
  const { barcode, quantity } = req.body;
  
  const item = db.prepare("SELECT * FROM items WHERE barcode = ?").get(barcode) as any;
  
  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }
  
  if (item.stock < quantity) {
    return res.status(400).json({ error: "Insufficient stock" });
  }
  
  const totalPrice = item.price * quantity;
  
  const transaction = db.transaction(() => {
    db.prepare("UPDATE items SET stock = stock - ? WHERE id = ?").run(quantity, item.id);
    db.prepare(
      "INSERT INTO sales (item_id, quantity, total_price) VALUES (?, ?, ?)"
    ).run(item.id, quantity, totalPrice);
  });
  
  transaction();
  res.json({ success: true, totalPrice });
});

app.get("/api/sales/stats", (req, res) => {
  const stats = db.prepare(`
    SELECT 
      SUM(total_price) as totalRevenue,
      COUNT(*) as totalSales,
      (SELECT COUNT(*) FROM items) as totalItems,
      (SELECT SUM(stock) FROM items) as totalStock
    FROM sales
  `).get();
  res.json(stats);
});

app.get("/api/sales/by-item", (req, res) => {
  const salesByItem = db.prepare(`
    SELECT 
      items.name,
      SUM(sales.quantity) as total_quantity,
      SUM(sales.total_price) as total_revenue
    FROM sales
    JOIN items ON sales.item_id = items.id
    GROUP BY items.id
    ORDER BY total_quantity DESC
  `).all();
  res.json(salesByItem);
});

app.delete("/api/sales", checkAdmin, (req, res) => {
  try {
    db.prepare("DELETE FROM sales").run();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/sales/:id", checkAdmin, (req, res) => {
  const { id } = req.params;
  try {
    const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(id) as any;
    if (!sale) return res.status(404).json({ error: "Sale not found" });

    const transaction = db.transaction(() => {
      db.prepare("UPDATE items SET stock = stock + ? WHERE id = ?").run(sale.quantity, sale.item_id);
      db.prepare("DELETE FROM sales WHERE id = ?").run(id);
    });
    transaction();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/sales/:id", checkAdmin, (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;
  try {
    const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(id) as any;
    if (!sale) return res.status(404).json({ error: "Sale not found" });

    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(sale.item_id) as any;
    if (!item) return res.status(404).json({ error: "Item not found" });

    const diff = quantity - sale.quantity;
    if (item.stock < diff) {
      return res.status(400).json({ error: "Insufficient stock for update" });
    }

    const newTotalPrice = item.price * quantity;

    const transaction = db.transaction(() => {
      db.prepare("UPDATE items SET stock = stock - ? WHERE id = ?").run(diff, sale.item_id);
      db.prepare("UPDATE sales SET quantity = ?, total_price = ? WHERE id = ?").run(quantity, newTotalPrice, id);
    });
    transaction();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Vite middleware for development
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupVite();
