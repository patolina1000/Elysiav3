#!/usr/bin/env node

/**
 * Script para configurar TOKEN_SECRET no .env
 * Garante que a chave de criptografia seja consistente
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

// Verificar se .env existe
if (!fs.existsSync(envPath)) {
  console.log('[SETUP] .env não encontrado. Criando a partir de .env.example...');
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('[SETUP] ✓ .env criado com sucesso');
  } else {
    console.error('[SETUP] Erro: .env.example não encontrado');
    process.exit(1);
  }
}

// Ler conteúdo do .env
let envContent = fs.readFileSync(envPath, 'utf8');

// Verificar se TOKEN_SECRET já existe
if (envContent.includes('TOKEN_SECRET=')) {
  console.log('[SETUP] TOKEN_SECRET já está configurado no .env');
  process.exit(0);
}

// Adicionar TOKEN_SECRET se não existir
const tokenSecret = 'dev-secret-change-in-production-min-32-chars';
envContent += `\n# Segurança - Chave para criptografia de tokens\nTOKEN_SECRET=${tokenSecret}\n`;

fs.writeFileSync(envPath, envContent);
console.log('[SETUP] ✓ TOKEN_SECRET adicionado ao .env');
console.log('[SETUP] Valor: ' + tokenSecret);
console.log('[SETUP] ⚠️  Em produção, altere para uma chave segura!');
