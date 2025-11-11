#!/usr/bin/env node

/**
 * Script para validar token do bot via API
 * Uso: node validate-bot-token.js <botId> <token>
 * Exemplo: node validate-bot-token.js 14 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
 */

require('dotenv').config();

const axios = require('axios');

async function validateBotToken(botId, token) {
  if (!botId || !token) {
    console.error('[VALIDATE] Uso: node validate-bot-token.js <botId> <token>');
    process.exit(1);
  }

  try {
    console.log(`[VALIDATE] Validando token para bot ${botId}...`);
    
    const response = await axios.post(
      `http://localhost:3000/api/admin/bots/${botId}/validate-token`,
      { token },
      { timeout: 10000 }
    );

    if (response.data.success && response.data.data.ok) {
      console.log(`[VALIDATE] ✓ Token validado com sucesso!`);
      console.log(`[VALIDATE] Username: ${response.data.data.username}`);
      console.log(`[VALIDATE] Name: ${response.data.data.name}`);
      console.log(`[VALIDATE] Checked at: ${response.data.data.checked_at}`);
    } else if (response.data.ok) {
      console.log(`[VALIDATE] ✓ Token validado com sucesso!`);
      console.log(`[VALIDATE] Username: ${response.data.username}`);
      console.log(`[VALIDATE] Name: ${response.data.name}`);
      console.log(`[VALIDATE] Checked at: ${response.data.checked_at}`);
    } else {
      console.error(`[VALIDATE] ✗ Erro ao validar token`);
      console.error(`[VALIDATE] Response:`, JSON.stringify(response.data, null, 2));
      process.exit(1);
    }
  } catch (error) {
    console.error(`[VALIDATE] Erro: ${error.message}`);
    if (error.response) {
      console.error(`[VALIDATE] Response:`, JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

const botId = process.argv[2];
const token = process.argv[3];

validateBotToken(botId, token);
