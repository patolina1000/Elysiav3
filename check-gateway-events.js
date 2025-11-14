require('dotenv').config();
const {pool} = require('./src/db');

pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'gateway_events' ORDER BY ordinal_position`)
  .then(r => {
    console.log('Colunas gateway_events:', r.rows.map(x => x.column_name).join(', '));
    pool.end();
  })
  .catch(e => {
    console.error('Erro:', e.message);
    pool.end();
  });
