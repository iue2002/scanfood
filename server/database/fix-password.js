const mysql = require('mysql2/promise');

async function fixPassword() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '123456',
    database: 'scanfood'
  });

  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin123', 10);
  console.log('Generated hash:', hash);

  await conn.execute(
    "UPDATE users SET password = ? WHERE username IN ('admin', 'staff')",
    [hash]
  );

  const [rows] = await conn.execute('SELECT username, password FROM users');
  console.log('Updated users:', rows);

  await conn.end();
}

fixPassword().catch(console.error);
