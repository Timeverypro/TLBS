import express from 'express';
import { neon } from '@neondatabase/serverless';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

const sql = neon(process.env.DATABASE_URL);

// 1. GET ALL BOOKS
app.get('/api/books', async (req, res) => {
  try {
    const books = await sql`
      SELECT books.*, users.full_name as owner_name 
      FROM books 
      JOIN users ON books.owner_id = users.id
      ORDER BY books.created_at DESC
    `;
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. ADD A NEW BOOK COPY
app.post('/api/books', async (req, res) => {
  const { ownerId, title, author, description, barcodeId, isbn } = req.body;
  try {
    const [newBook] = await sql`
      INSERT INTO books (owner_id, title, author, description, barcode_id, isbn)
      VALUES (${ownerId}, ${title}, ${author}, ${description}, ${barcodeId}, ${isbn || null})
      RETURNING *;
    `;
    res.status(201).json({ success: true, book: newBook });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. BORROW BOOK BY BARCODE ID
app.post('/api/borrow', async (req, res) => {
  const { barcodeId, borrowerId, dueDays = 14 } = req.body;
  try {
    const [book] = await sql`SELECT id, status FROM books WHERE barcode_id = ${barcodeId}`;
    if (!book) {
      return res.status(404).json({ error: "Book with this Barcode ID not found." });
    }
    if (book.status !== 'available') {
      return res.status(400).json({ error: "This physical book copy is already borrowed." });
    }
    
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    await sql`UPDATE books SET status = 'borrowed' WHERE id = ${book.id}`;

    const [loan] = await sql`
      INSERT INTO loans (book_id, borrower_id, due_date)
      VALUES (${book.id}, ${borrowerId}, ${dueDate.toISOString()})
      RETURNING *;
    `;

    res.status(201).json({ success: true, message: "Book checked out successfully!", loan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. RETURN BOOK BY BARCODE ID
app.post('/api/return', async (req, res) => {
  const { barcodeId } = req.body;
  try {
    const [book] = await sql`SELECT id, status FROM books WHERE barcode_id = ${barcodeId}`;
    if (!book) {
      return res.status(404).json({ error: "Book with this Barcode ID not found." });
    }
    if (book.status !== 'borrowed') {
      return res.status(400).json({ error: "This book copy is not currently marked as borrowed." });
    }

    const [loan] = await sql`
      SELECT id FROM loans WHERE book_id = ${book.id} AND returned_date IS NULL
    `;
    
    if (loan) {
      await sql`UPDATE loans SET returned_date = NOW() WHERE id = ${loan.id}`;
    }

    await sql`UPDATE books SET status = 'available' WHERE id = ${book.id}`;

    res.json({ success: true, message: "Book returned successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});