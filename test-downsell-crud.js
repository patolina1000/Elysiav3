/**
 * Teste de CRUD de downsells via API
 */

const axios = require('axios');

const API_URL = 'http://localhost:3000/api/admin/bots';
const BOT_ID = 14;

async function testCRUD() {
  console.log('🧪 Testando CRUD de downsells\n');

  try {
    // 1. Criar novo downsell
    console.log('📝 Teste 1: Criar novo downsell');
    const createResponse = await axios.put(`${API_URL}/${BOT_ID}/config/downsells`, {
      downsells: [
        {
          slug: 'test-crud-downsell',
          name: 'Test CRUD Downsell',
          content: 'Este é um teste de CRUD!',
          delay_seconds: 30,
          active: true,
          trigger_type: 'start'
        }
      ]
    });
    console.log(`✅ Criado: ${JSON.stringify(createResponse.data.data)}\n`);

    // 2. Atualizar downsell
    console.log('📝 Teste 2: Atualizar downsell');
    const downsellId = createResponse.data.data[0].id;
    const updateResponse = await axios.put(`${API_URL}/${BOT_ID}/config/downsells`, {
      downsells: [
        {
          id: downsellId,
          slug: 'test-crud-downsell',
          name: 'Test CRUD Downsell ATUALIZADO',
          content: 'Conteúdo atualizado!',
          delay_seconds: 45,
          active: true,
          trigger_type: 'pix'
        }
      ]
    });
    console.log(`✅ Atualizado: ${JSON.stringify(updateResponse.data.data)}\n`);

    // 3. Deletar downsell (enviando array vazio)
    console.log('📝 Teste 3: Deletar todos downsells');
    const deleteResponse = await axios.put(`${API_URL}/${BOT_ID}/config/downsells`, {
      downsells: []
    });
    console.log(`✅ Deletado: ${JSON.stringify(deleteResponse.data)}\n`);

    // 4. Verificar que foi deletado
    console.log('📝 Teste 4: Verificar deleção');
    const checkResponse = await axios.get(`${API_URL}/${BOT_ID}/config`);
    console.log(`✅ Downsells restantes: ${checkResponse.data.data.downsells.length}\n`);

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ TODOS OS TESTES DE CRUD PASSARAM!');
    console.log('═══════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Erro:', error.response?.data || error.message);
    process.exit(1);
  }
}

testCRUD();
