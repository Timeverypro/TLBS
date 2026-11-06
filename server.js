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

// 1. GET ALL BOOKS (Includes active loan & borrower details)
app.get('/api/books', async (req, res) => {
  try {
    const books = await sql`
      SELECT books.*, 
             users.full_name as owner_name,
             loans.loan_date,
             loans.due_date,
             borrower.full_name as borrower_name
      FROM books 
      JOIN users ON books.owner_id = users.id
      LEFT JOIN loans ON loans.book_id = books.id AND loans.returned_date IS NULL
      LEFT JOIN users borrower ON loans.borrower_id = borrower.id
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

// 3. GET ALL USERS (Members / Borrowers)
app.get('/api/users', async (req, res) => {
  try {
    const users = await sql`SELECT id, full_name, email, role FROM users ORDER BY id ASC`;
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. REGISTER A NEW USER / BORROWER
app.post('/api/users', async (req, res) => {
  const { fullName, email, role = 'member' } = req.body;
  try {
    const [newUser] = await sql`
      INSERT INTO users (full_name, email, role)
      VALUES (${fullName}, ${email}, ${role})
      RETURNING *;
    `;
    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. BORROW BOOK BY BARCODE ID (Using Manual Due Date)
app.post('/api/borrow', async (req, res) => {
  const { barcodeId, borrowerId, dueDate } = req.body;
  try {
    const [book] = await sql`SELECT id, status FROM books WHERE barcode_id = ${barcodeId}`;
    if (!book) {
      return res.status(404).json({ error: "Book with this Barcode ID not found." });
    }
    if (book.status !== 'available') {
      return res.status(400).json({ error: "This physical book copy is already borrowed." });
    }
    if (!dueDate) {
      return res.status(400).json({ error: "Please select a due date." });
    }

    await sql`UPDATE books SET status = 'borrowed' WHERE id = ${book.id}`;

    const [loan] = await sql`
      INSERT INTO loans (book_id, borrower_id, due_date)
      VALUES (${book.id}, ${borrowerId}, ${dueDate})
      RETURNING *;
    `;

    res.status(201).json({ success: true, message: "Book checked out successfully!", loan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. RETURN BOOK BY BARCODE ID
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