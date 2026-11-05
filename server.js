import express from 'express';
import { neon } from '@neondatabase/serverless';

const app = express();
app.use(express.json()); // Allows parsing JSON request bodies

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
    // 1. Check who owns this book in the database
    const books = await sql`
      SELECT owner_id FROM books WHERE id = ${bookId}
    `;

    if (books.length === 0) {
      return res.status(404).json({ error: "Book not found." });
    }

    const book = books[0];

    // 2. Verify if the user making the request is the actual owner
    if (book.owner_id !== userId) {
      return res.status(403).json({ error: "Unauthorized: Only the owner can edit this book." });
    }

    // 3. If they are the owner, proceed with updating the description
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
    // Check if the book is actually available
    const [book] = await sql`SELECT status FROM books WHERE id = ${bookId}`;
    if (!book || book.status !== 'available') {
      return res.status(400).json({ error: "Book is not available for borrowing." });
    }
    
    // Calculate due date (default: 14 days from today)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    // Update book status to 'borrowed'
    await sql`UPDATE books SET status = 'borrowed' WHERE id = ${bookId}`;

    // Create the loan record
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
    // Find active loan
    const [loan] = await sql`SELECT book_id FROM loans WHERE id = ${loanId} AND returned_date IS NULL`;
    if (!loan) {
      return res.status(404).json({ error: "Active loan record not found." });
    }

    // Mark loan as returned
    await sql`UPDATE loans SET returned_date = NOW() WHERE id = ${loanId}`;

    // Set book status back to 'available'
    await sql`UPDATE books SET status = 'available' WHERE id = ${loan.book_id}`;

    res.json({ success: true, message: "Book returned successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start the server
app.listen(3000, () => {
  console.log('Server running on port 3000');
});