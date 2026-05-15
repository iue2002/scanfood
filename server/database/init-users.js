const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function initUsers() {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '123456', database: 'scanfood' });
  const hash = bcrypt.hashSync('admin123', 10);
  await conn.execute(
    "INSERT INTO users (username, password, role, nickname) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
    ['admin', hash, 'admin', '系统管理员', 'staff', hash, 'staff', '前台员工']
  );
  console.log('Users inserted');
  await conn.end();
}

initUsers().catch(console.error);
