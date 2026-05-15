const mysql = require('mysql2/promise');

async function reset() {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '123456', database: 'scanfood' });
  await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
  const tables = ['refunds', 'print_records', 'order_items', 'orders', 'dish_specs', 'dishes', 'dish_categories', 'tables', 'users'];
  for (const t of tables) {
    await conn.execute('DROP TABLE IF EXISTS ' + t);
  }
  await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
  console.log('All tables dropped');
  await conn.end();
}

reset().catch(console.error);
