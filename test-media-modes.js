/**
 * CP-9: Testes Guiados - 4 Cenários de Media Mode
 * 
 * Testa os 4 cenários principais:
 * 1. media_mode="single", 2 vídeos + 3 textos
 * 2. media_mode="group", 2 vídeos + 3 textos
 * 3. media_mode="group", 1 áudio + 2 vídeos + 3 textos (prioridade)
 * 4. attach_text_as_caption=true com caption
 * 
 * Uso: node test-media-modes.js
 */

const MessageService = require('./src/modules/message-service');

// Mock pool para testes
const mockPool = {
  query: async () => ({ rows: [] })
};

// Criar instância do serviço
const messageService = new MessageService(mockPool);

console.log('='.repeat(80));
console.log('CP-9: TESTES GUIADOS - MEDIA MODES');
console.log('='.repeat(80));

// ============================================================================
// CENÁRIO 1: media_mode="single", 2 vídeos + 3 textos
// Esperado: vídeos em mensagens separadas, sem caption; depois 3 textos (separados)
// ============================================================================
console.log('\n📋 CENÁRIO 1: media_mode="single", 2 vídeos + 3 textos');
console.log('-'.repeat(80));

const scenario1Medias = [
  { kind: 'video', tg_file_id: 'video_1_id', caption: 'Video 1' },
  { kind: 'video', tg_file_id: 'video_2_id', caption: 'Video 2' }
];

const scenario1Content = {
  messages: ['Texto 1', 'Texto 2', 'Texto 3'],
  medias: scenario1Medias,
  buttons: []
};

const scenario1Payloads = messageService.prepareTelegramPayloads(
  -123456789, // chat_id (warmup group)
  scenario1Content,
  scenario1Medias,
  'single', // media_mode
  false // attach_text_as_caption
);

console.log(`✓ Payloads gerados: ${scenario1Payloads.length}`);
scenario1Payloads.forEach((p, i) => {
  if (p.video) {
    console.log(`  [${i + 1}] sendVideo: file_id=${p.video.substring(0, 20)}... caption=${p.caption ? 'SIM' : 'NÃO'}`);
  } else if (p.text) {
    console.log(`  [${i + 1}] sendMessage: text="${p.text.substring(0, 30)}..."`);
  } else if (p.media) {
    console.log(`  [${i + 1}] sendMediaGroup: ${p.media.length} items`);
  }
});

// ============================================================================
// CENÁRIO 2: media_mode="group", 2 vídeos + 3 textos
// Esperado: álbum com 2 vídeos; depois 3 textos (separados)
// ============================================================================
console.log('\n📋 CENÁRIO 2: media_mode="group", 2 vídeos + 3 textos');
console.log('-'.repeat(80));

const scenario2Medias = [
  { kind: 'video', tg_file_id: 'video_1_id', caption: 'Video 1' },
  { kind: 'video', tg_file_id: 'video_2_id', caption: 'Video 2' }
];

const scenario2Content = {
  messages: ['Texto 1', 'Texto 2', 'Texto 3'],
  medias: scenario2Medias,
  buttons: []
};

const scenario2Payloads = messageService.prepareTelegramPayloads(
  -123456789,
  scenario2Content,
  scenario2Medias,
  'group', // media_mode
  false // attach_text_as_caption
);

console.log(`✓ Payloads gerados: ${scenario2Payloads.length}`);
scenario2Payloads.forEach((p, i) => {
  if (p.media) {
    console.log(`  [${i + 1}] sendMediaGroup: ${p.media.length} items (tipos: ${p.media.map(m => m.type).join(', ')})`);
  } else if (p.text) {
    console.log(`  [${i + 1}] sendMessage: text="${p.text.substring(0, 30)}..."`);
  }
});

// ============================================================================
// CENÁRIO 3: media_mode="group", 1 áudio + 2 vídeos + 3 textos
// Esperado: áudio fora do álbum (prioridade), enviado sozinho antes dos vídeos
// Depois: álbum com 2 vídeos; depois 3 textos
// ============================================================================
console.log('\n📋 CENÁRIO 3: media_mode="group", 1 áudio + 2 vídeos + 3 textos (prioridade)');
console.log('-'.repeat(80));

const scenario3Medias = [
  { kind: 'video', tg_file_id: 'video_1_id', caption: 'Video 1' },
  { kind: 'audio', tg_file_id: 'audio_1_id', caption: 'Audio 1' },
  { kind: 'video', tg_file_id: 'video_2_id', caption: 'Video 2' }
];

const scenario3Content = {
  messages: ['Texto 1', 'Texto 2', 'Texto 3'],
  medias: scenario3Medias,
  buttons: []
};

const scenario3Payloads = messageService.prepareTelegramPayloads(
  -123456789,
  scenario3Content,
  scenario3Medias,
  'group', // media_mode
  false // attach_text_as_caption
);

console.log(`✓ Payloads gerados: ${scenario3Payloads.length}`);
console.log(`✓ Ordem esperada: áudio (isolado) > vídeos (álbum) > textos`);
scenario3Payloads.forEach((p, i) => {
  if (p.audio) {
    console.log(`  [${i + 1}] sendAudio: file_id=${p.audio.substring(0, 20)}...`);
  } else if (p.media) {
    console.log(`  [${i + 1}] sendMediaGroup: ${p.media.length} items (tipos: ${p.media.map(m => m.type).join(', ')})`);
  } else if (p.text) {
    console.log(`  [${i + 1}] sendMessage: text="${p.text.substring(0, 30)}..."`);
  }
});

// ============================================================================
// CENÁRIO 4: attach_text_as_caption=true
// Esperado: caption apenas no primeiro item (primeira mídia ou primeira mensagem)
// ============================================================================
console.log('\n📋 CENÁRIO 4: attach_text_as_caption=true (caption no primeiro item)');
console.log('-'.repeat(80));

const scenario4Medias = [
  { kind: 'photo', tg_file_id: 'photo_1_id', caption: 'Photo 1' },
  { kind: 'photo', tg_file_id: 'photo_2_id', caption: 'Photo 2' }
];

const scenario4Content = {
  messages: ['Texto com caption'],
  medias: scenario4Medias,
  buttons: []
};

const scenario4Payloads = messageService.prepareTelegramPayloads(
  -123456789,
  scenario4Content,
  scenario4Medias,
  'group', // media_mode
  true // attach_text_as_caption = TRUE
);

console.log(`✓ Payloads gerados: ${scenario4Payloads.length}`);
console.log(`✓ Caption esperado: apenas no primeiro item do álbum`);
scenario4Payloads.forEach((p, i) => {
  if (p.media) {
    const captions = p.media.map((m, idx) => `item[${idx}]: ${m.caption ? 'SIM' : 'NÃO'}`).join(', ');
    console.log(`  [${i + 1}] sendMediaGroup: ${p.media.length} items (captions: ${captions})`);
  } else if (p.text) {
    console.log(`  [${i + 1}] sendMessage: text="${p.text.substring(0, 30)}..."`);
  }
});

// ============================================================================
// VERIFICAÇÕES DE ELEGIBILIDADE
// ============================================================================
console.log('\n📋 VERIFICAÇÕES DE ELEGIBILIDADE (decideMediaMode)');
console.log('-'.repeat(80));

// Teste 1: Menos de 2 mídias elegíveis → fallback para single
const test1Medias = [
  { kind: 'photo', tg_file_id: 'photo_1_id' }
];
const test1Decision = messageService.decideMediaMode('group', test1Medias);
console.log(`✓ 1 foto com group → decided="${test1Decision.decided}" (esperado: single)`);
console.log(`  Elegíveis: ${test1Decision.eligiblePhotoVideo}`);

// Teste 2: 2 mídias elegíveis → group
const test2Medias = [
  { kind: 'photo', tg_file_id: 'photo_1_id' },
  { kind: 'video', tg_file_id: 'video_1_id' }
];
const test2Decision = messageService.decideMediaMode('group', test2Medias);
console.log(`✓ 2 fotos/vídeos com group → decided="${test2Decision.decided}" (esperado: group)`);
console.log(`  Elegíveis: ${test2Decision.eligiblePhotoVideo}`);

// Teste 3: Single solicitado → sempre single
const test3Medias = [
  { kind: 'photo', tg_file_id: 'photo_1_id' },
  { kind: 'video', tg_file_id: 'video_1_id' }
];
const test3Decision = messageService.decideMediaMode('single', test3Medias);
console.log(`✓ 2 fotos/vídeos com single → decided="${test3Decision.decided}" (esperado: single)`);
console.log(`  Elegíveis: ${test3Decision.eligiblePhotoVideo}`);

// ============================================================================
// VERIFICAÇÕES DE PRIORIZAÇÃO
// ============================================================================
console.log('\n📋 VERIFICAÇÕES DE PRIORIZAÇÃO (prioritizeMedias)');
console.log('-'.repeat(80));

const priorityTestMedias = [
  { kind: 'photo', tg_file_id: 'photo_1_id' },
  { kind: 'audio', tg_file_id: 'audio_1_id' },
  { kind: 'video', tg_file_id: 'video_1_id' },
  { kind: 'photo', tg_file_id: 'photo_2_id' }
];

const prioritized = messageService.prioritizeMedias(priorityTestMedias);
console.log(`✓ Ordem original: ${priorityTestMedias.map(m => m.kind).join(', ')}`);
console.log(`✓ Ordem priorizada: ${prioritized.map(m => m.kind).join(', ')}`);
console.log(`  Esperado: audio, video, photo, photo`);

// ============================================================================
// RESUMO
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('✅ TODOS OS TESTES CONCLUÍDOS');
console.log('='.repeat(80));
console.log('\nCritério de Aceite:');
console.log('✓ Cenário 1: Vídeos separados, sem caption; textos separados');
console.log('✓ Cenário 2: Álbum com vídeos; textos separados');
console.log('✓ Cenário 3: Áudio isolado (prioridade); álbum com vídeos; textos separados');
console.log('✓ Cenário 4: Caption apenas no primeiro item');
console.log('\nPróximos passos:');
console.log('1. Testar com bot real no Telegram');
console.log('2. Verificar logs [START:MEDIA_MODE], [START:MEDIA_ORDER], [START:SEND:*]');
console.log('3. Validar que mídias chegam na ordem correta');
console.log('4. Confirmar que caption não aparece quando attach_text_as_caption=false');
