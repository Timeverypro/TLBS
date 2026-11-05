import express from 'express';
import { neon } from '@neondatabase/serverless';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json()); // Allows parsing JSON request bodies

// Set up directory path for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static frontend files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Connect to Neon DB using your connection string from .env
const sql = neon(process.env.DATABASE_URL);

// ==========================================
// 1. GET ALL BOOKS (Catalog view with owner names)
// ==========================================
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

// ==========================================
// 2. ADD A NEW BOOK (With custom barcode)
// ==========================================
app.post('/api/books', async (req, res) => {
  const { ownerId, title, author, description, barcodeId } = req.body;
  
  try {
    const [newBook] = await sql`
      INSERT INTO books (owner_id, title, author, description, barcode_id)
      VALUES (${ownerId}, ${title}, ${author}, ${description}, ${barcodeId})
      RETURNING *;
    `;
    res.status(201).json({ success: true, book: newBook });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. UPDATE BOOK DESCRIPTION (Owner Only)
// ==========================================
app.put('/api/books/:id', async (req, res) => {
  const bookId = req.params.id;
  const { userId, newDescription } = req.body;

  try {
    const books = await sql`
      SELECT owner_id FROM books WHERE id = ${bookId}
    `;

    if (books.length === 0) {
      return res.status(404).json({ error: "Book not found." });
    }

    const book = books[0];

    if (book.owner_id !== userId) {
      return res.status(403).json({ error: "Unauthorized: Only the owner can edit this book." });
    }

    const updatedBook = await sql`
      UPDATE books 
      SET description = ${newDescription} 
      WHERE id = ${bookId}
      RETURNING *;
    `;

    res.json({ 
      success: true, 
      message: "Book updated successfully!", 
      book: updatedBook[0] 
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. BORROW A BOOK (Checks out and sets due date)
// ==========================================
app.post('/api/loans', async (req, res) => {
  const { bookId, borrowerId, dueDays = 14 } = req.body;
  
  try {
    const [book] = await sql`SELECT status FROM books WHERE id = ${bookId}`;
    if (!book || book.status !== 'available') {
      return res.status(400).json({ error: "Book is not available for borrowing." });
    }
    
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    await sql`UPDATE books SET status = 'borrowed' WHERE id = ${bookId}`;

    const [loan] = await sql`
      INSERT INTO loans (book_id, borrower_id, due_date)
      VALUES (${bookId}, ${borrowerId}, ${dueDate.toISOString()})
      RETURNING *;
    `;

    res.status(201).json({ success: true, message: "Book checked out successfully!", loan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. RETURN A BOOK (Makes it available again)
// ==========================================
app.put('/api/loans/:id/return', async (req, res) => {
  const loanId = req.params.id;
  
  try {
    const [loan] = await sql`SELECT book_id FROM loans WHERE id = ${loanId} AND returned_date IS NULL`;
    if (!loan) {
      return res.status(404).json({ error: "Active loan record not found." });
    }

    await sql`UPDATE loans SET returned_date = NOW() WHERE id = ${loanId}`;
    await sql`UPDATE books SET status = 'available' WHERE id = ${loan.book_id}`;

    res.json({ success: true, message: "Book returned successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all route using a Regex to avoid path-to-regexp parsing errors
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});