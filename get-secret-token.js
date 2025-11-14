#!/usr/bin/env node

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function getSecretToken() {
  try {
    const result = await pool.query(
      "SELECT id, slug, webhook_secret_token FROM bots WHERE slug = 'vipshadriee_bot'"
    );

    if (result.rows.length === 0) {
      console.log('Bot não encontrado');
      return;
    }

    const bot = result.rows[0];
    console.log('Bot:', bot.slug);
    console.log('ID:', bot.id);
    console.log('Secret Token:', bot.webhook_secret_token || '(não configurado)');

  } catch (error) {
    console.error('Erro:', error.message);
  } finally {
    await pool.end();
  }
}

getSecretToken();
