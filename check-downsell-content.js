/**
 * Script para verificar o conteúdo dos downsells no banco
 */

const { Pool } = require('pg');

async function checkDownsellContent() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/elysia'
  });

  try {
    console.log('\n=== VERIFICANDO CONTEÚDO DOS DOWNSELLS ===\n');

    const result = await pool.query(
      `SELECT id, bot_id, slug, name, content, delay_seconds, active, trigger_type 
       FROM bot_downsells 
       ORDER BY bot_id, id`
    );

    if (result.rows.length === 0) {
      console.log('Nenhum downsell encontrado no banco.\n');
      return;
    }

    console.log(`Total de downsells: ${result.rows.length}\n`);

    for (const row of result.rows) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`ID: ${row.id}`);
      console.log(`Bot ID: ${row.bot_id}`);
      console.log(`Slug: ${row.slug}`);
      console.log(`Name: ${row.name || '(não definido)'}`);
      console.log(`Delay: ${row.delay_seconds}s`);
      console.log(`Trigger: ${row.trigger_type}`);
      console.log(`Active: ${row.active}`);
      
      // Parsear content
      let content = row.content;
      if (typeof content === 'string') {
        try {
          content = JSON.parse(content);
        } catch (e) {
          console.log(`Content (string): ${content}`);
          console.log('');
          continue;
        }
      }

      console.log('\nContent:');
      console.log(`  - text: ${content.text ? 'SIM' : 'NÃO'} (${content.text?.length || 0} chars)`);
      console.log(`  - medias: ${content.medias ? 'SIM' : 'NÃO'} (${content.medias?.length || 0} itens)`);
      console.log(`  - plans: ${content.plans ? 'SIM' : 'NÃO'} (${content.plans?.length || 0} itens)`);
      console.log(`  - media_mode: ${content.media_mode || '(não definido)'}`);
      console.log(`  - attach_text_as_caption: ${content.attach_text_as_caption !== undefined ? content.attach_text_as_caption : '(não definido)'}`);

      if (content.medias && content.medias.length > 0) {
        console.log('\n  Mídias:');
        content.medias.forEach((media, i) => {
          console.log(`    ${i + 1}. kind: ${media.kind}, sha256: ${media.sha256?.substring(0, 16)}...`);
        });
      }

      if (content.plans && content.plans.length > 0) {
        console.log('\n  Planos:');
        content.plans.forEach((plan, i) => {
          const price = plan.price_cents || plan.priceCents || plan.price || 0;
          const name = plan.name || plan.title || `Plano ${i + 1}`;
          console.log(`    ${i + 1}. ${name} - R$ ${(price / 100).toFixed(2)}`);
        });
      }

      console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('Erro:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkDownsellContent()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
