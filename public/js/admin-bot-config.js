let currentBotId = null;
let currentConfig = null;
let currentMediaMode = 'group'; // 'group' ou 'single'
let currentPlansLayout = 'adjacent'; // 'adjacent' ou 'list'

// Estado do downsell em edição
let currentDownsellPlans = [];
let currentDownsellMedia = null;
let currentDownsellTrigger = 'start';

// Estado do shot em edição
let currentShotPlans = [];
let currentShotMedia = null;
let currentShotTrigger = 'start';
let currentShotScheduleType = 'immediate';

// Inicializar ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  currentBotId = params.get('botId');

  if (!currentBotId) {
    showErrorState('Bot não informado. Volte para a lista de bots.');
    return;
  }

  loadBotConfig();
  
  // Inicializar máscara de moeda no campo de valor do plano
  setupCurrencyMask();
});

function setupCurrencyMask() {
  // Aplicar máscara quando o modal for aberto
  document.addEventListener('input', (e) => {
    if (e.target.id === 'planValue') {
      let value = e.target.value.replace(/\D/g, '');
      if (value) {
        value = (parseInt(value) / 100).toFixed(2);
        e.target.value = value.replace('.', ',');
      }
    }
  });
}

async function loadBotConfig() {
  try {
    const response = await fetch(`/api/admin/bots/${currentBotId}/config`);
    const result = await response.json();

    if (!result.success) {
      showErrorState(result.error || 'Erro ao carregar configuração');
      return;
    }

    currentConfig = result.data;
    renderBotHeader();
    renderStartMessage();
    renderDownsells();
    renderShots();
    showTabsContainer();
  } catch (error) {
    console.error('Erro ao carregar config:', error);
    showErrorState('Erro ao carregar configuração: ' + error.message);
  }
}

function renderBotHeader() {
  const bot = currentConfig.bot;
  document.getElementById('botName').textContent = bot.name || bot.slug;
  document.getElementById('botId').textContent = bot.id;
  document.getElementById('botGateway').textContent = bot.provider || 'N/A';
  document.getElementById('botStatus').textContent = bot.active ? 'Ativo' : 'Inativo';
  document.getElementById('botStatus').className = `badge ${bot.active ? 'badge-success' : 'badge-error'}`;
  document.getElementById('botHeaderCard').style.display = 'flex';
}

// renderStartMessage está definida no final do arquivo

function renderMessages(messages) {
  const container = document.getElementById('messagesList');
  
  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Nenhuma mensagem configurada ainda.</p>
        <p><small>Clique em "Adicionar mensagem" para criar a primeira mensagem.</small></p>
      </div>
    `;
    return;
  }
  
  let html = '';
  messages.forEach((message, index) => {
    // Normalizar message para string (nunca deixar objeto no textarea)
    let messageText = '';
    if (typeof message === 'string') {
      messageText = message;
    } else if (typeof message === 'object' && message !== null && message.text) {
      messageText = String(message.text);
    } else if (message !== null && message !== undefined) {
      messageText = String(message);
    }
    
    const charCount = messageText.length;
    
    html += `
      <div class="config-item-card" data-message-index="${index}">
        <div class="config-item-header">
          <div class="config-item-title">Mensagem ${index + 1}</div>
          <div class="config-item-actions">
            <button type="button" class="btn-danger btn-small" onclick="removeMessage(${index})">Remover</button>
          </div>
        </div>
        <div class="config-item-content">
          <textarea placeholder="Digite a mensagem..." onkeyup="updateCharCounter(this, ${index})">${messageText}</textarea>
          <div class="char-counter">${charCount} caracteres</div>
        </div>
        <div class="config-item-meta">
          <span>Suporta templates: {user_name}, {user_id}, {bot_name}</span>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Atualizar botão de adicionar
  const addBtn = document.getElementById('addMessageBtn');
  if (messages.length >= 3) {
    addBtn.style.display = 'none';
  } else {
    addBtn.style.display = 'inline-block';
  }
}

function renderMedias(medias) {
  const container = document.getElementById('mediasList');
  
  if (medias.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Nenhuma mídia configurada ainda.</p>
        <p><small>Clique em "Adicionar mídia" para anexar fotos, vídeos ou documentos.</small></p>
      </div>
    `;
    return;
  }
  
  let html = '';
  medias.forEach((media, index) => {
    const typeIcons = {
      photo: '📷',
      video: '🎥',
      audio: '🎵',
      document: '📄'
    };
    
    // Garantir que media é um objeto com propriedades string
    const mediaType = String(media.type || media.kind || 'document');
    const mediaName = String(media.name || `Mídia ${index + 1}`);
    const mediaCaption = media.caption ? String(media.caption) : '';
    
    html += `
      <div class="config-item-card" data-media-index="${index}">
        <div class="config-item-header">
          <div class="config-item-title">${typeIcons[mediaType] || '📄'} ${mediaName}</div>
          <div class="config-item-actions">
            <button type="button" class="btn-danger btn-small" onclick="removeMedia(${index})">Remover</button>
          </div>
        </div>
        <div class="media-preview">
          <div class="media-icon">${typeIcons[mediaType] || 'DOC'}</div>
          <div class="media-info">
            <div class="media-name">${mediaName}</div>
            <div class="media-type">${mediaType}</div>
            ${mediaCaption ? `<div class="media-caption">${mediaCaption}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Atualizar botão de adicionar
  const addBtn = document.getElementById('addMediaBtn');
  if (medias.length >= 3) {
    addBtn.style.display = 'none';
  } else {
    addBtn.style.display = 'inline-block';
  }
}

function renderPlans(plans) {
  const container = document.getElementById('plansList');
  
  if (plans.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Nenhum plano configurado ainda.</p>
        <p><small>Clique em "Adicionar plano" para criar o primeiro plano.</small></p>
      </div>
    `;
    return;
  }
  
  let html = '';
  plans.forEach((plan, index) => {
    // Garantir que plan é um objeto com propriedades string
    const planName = String(plan.name || `Plano ${index + 1}`);
    const planTime = String(plan.time || 'N/A');
    const valueFormatted = formatCurrency(plan.value);
    
    html += `
      <div class="config-item-card" data-plan-index="${index}">
        <div class="config-item-header">
          <div class="config-item-title">${planName}</div>
          <div class="config-item-actions">
            <button type="button" class="btn-secondary btn-small" onclick="editPlan(${index})">Editar</button>
            <button type="button" class="btn-danger btn-small" onclick="removePlan(${index})">Remover</button>
          </div>
        </div>
        <div class="config-item-meta">
          <span>Duração: ${planTime}</span>
          <span>Valor: ${valueFormatted}</span>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Atualizar botão de adicionar
  const addBtn = document.getElementById('addPlanBtn');
  if (plans.length >= 10) {
    addBtn.style.display = 'none';
  } else {
    addBtn.style.display = 'inline-block';
  }
}

function renderDownsells() {
  const downsells = currentConfig.downsells || [];
  const container = document.getElementById('downsellsList');

  if (downsells.length === 0) {
    container.innerHTML = '<p style="color: var(--text-tertiary); text-align: center;">Nenhum downsell configurado</p>';
    return;
  }

  let html = '';
  downsells.forEach(downsell => {
    const status = downsell.active ? 'Ativo' : 'Inativo';
    const delay_minutes = Math.round(downsell.delay_seconds / 60);
    
    // Informações adicionais
    const triggerLabel = downsell.trigger_type === 'pix_created' ? '💳 Após PIX' : '🚀 Após /start';
    const plansCount = Array.isArray(downsell.plans) ? downsell.plans.length : 0;
    const hasMedia = downsell.media ? '📎' : '';
    
    html += `
      <div class="item-card">
        <div class="item-card-content">
          <div class="item-card-title">${downsell.slug} ${hasMedia}</div>
          <div class="item-card-meta">
            ${triggerLabel} | Delay: ${delay_minutes}min | Status: ${status}
            ${plansCount > 0 ? ` | ${plansCount} plano(s)` : ''}
          </div>
        </div>
        <div class="item-card-actions">
          <button class="btn-secondary btn-small" onclick="editDownsell(${downsell.id})">Editar</button>
          <button class="btn-danger btn-small" onclick="deleteDownsell(${downsell.id})">Deletar</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderShots() {
  const shots = currentConfig.shots || [];
  const container = document.getElementById('shotsList');

  if (shots.length === 0) {
    container.innerHTML = '<p style="color: var(--text-tertiary); text-align: center;">Nenhum shot configurado</p>';
    return;
  }

  let html = '';
  shots.forEach(shot => {
    const status = shot.active ? 'Ativo' : 'Inativo';
    
    // Determinar tipo de disparo
    let scheduleInfo = '';
    if (shot.schedule_type === 'scheduled' && shot.scheduled_at) {
      const scheduledDate = new Date(shot.scheduled_at);
      const dateStr = scheduledDate.toLocaleString('pt-BR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit' 
      });
      scheduleInfo = `| 📅 Agendado: ${dateStr}`;
    } else {
      scheduleInfo = '| ⚡ Disparo Imediato';
    }
    
    html += `
      <div class="item-card">
        <div class="item-card-content">
          <div class="item-card-title">${shot.slug}</div>
          <div class="item-card-meta">
            Status: ${status} ${scheduleInfo} ${shot.filter_criteria ? `| Filtro: ${shot.filter_criteria}` : ''}
          </div>
        </div>
        <div class="item-card-actions">
          <span class="item-card-pending" style="color: var(--text-tertiary); font-size: 0.85em;">
            🕒 Pendente de envio
          </span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

window.switchTab = function switchTab(tabName) {
  // Remover classe active de todos os botões e panes
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

  // Adicionar classe active ao botão e pane selecionados
  event.target.classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // Se mudou para tab Controle, carregar KPIs
  if (tabName === 'control') {
    loadControlKPIs();
  }
  
  // Se mudou para tab Usuários, carregar lista de usuários
  if (tabName === 'users') {
    loadUsers();
  }
}

function showTabsContainer() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('tabsContainer').style.display = 'block';
  
  // Carregar KPIs automaticamente (tab Controle é padrão)
  loadControlKPIs();
}

function showErrorState(message) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('errorState').style.display = 'block';
  document.getElementById('errorMessage').textContent = message;
}

window.updateMediaModeDisplay = function updateMediaModeDisplay() {
  const modeSelect = document.getElementById('mediaMode');
  const helpText = document.getElementById('mediaModeHelp');
  const mode = modeSelect.value;

  currentMediaMode = mode;
  
  if (mode === 'group') {
    helpText.innerHTML = '<strong>Grupo:</strong> Fotos e vídeos são agrupados em um álbum. Áudios e documentos são enviados isoladamente.';
  } else {
    helpText.innerHTML = '<strong>Uma por vez:</strong> Todas as mídias são enviadas individualmente, respeitando a ordem: áudio > vídeo > foto.';
  }
}

window.updatePlansLayout = function updatePlansLayout() {
  const layoutSelect = document.getElementById('plansLayout');
  if (!layoutSelect) {
    currentPlansLayout = 'adjacent';
    return;
  }

  const value = layoutSelect.value;
  currentPlansLayout = value === 'list' ? 'list' : 'adjacent';
}

window.saveStartConfiguration = async function saveStartConfiguration() {
  try {
    // Coletar mensagens do DOM (não usar estado global que pode estar desatualizado)
    const messages = getCurrentMessages();
    
    if (!messages || messages.length === 0) {
      showAlert('Pelo menos uma mensagem é obrigatória', 'error');
      return;
    }
    
    // Garantir que todas as mensagens são strings válidas (NUNCA objetos)
    const validMessages = messages
      .map(msg => {
        if (typeof msg === 'string') return msg;
        if (typeof msg === 'object' && msg !== null && msg.text) return String(msg.text);
        if (msg === null || msg === undefined) return '';
        return String(msg);
      })
      .filter(msg => msg && msg.trim()); // Remover vazias
    
    if (validMessages.length === 0) {
      showAlert('Pelo menos uma mensagem é obrigatória', 'error');
      return;
    }

    if (validMessages.length > 3) {
      showAlert('Máximo 3 mensagens permitidas', 'error');
      return;
    }
    
    // Coletar mídias (do estado global)
    const medias = currentMedias || [];
    
    // Coletar planos (do estado global)
    const plans = currentPlans || [];
    
    // Coletar modo de envio de mídias
    const mediaMode = document.getElementById('mediaMode').value || 'group';
    const plansLayoutSelect = document.getElementById('plansLayout');
    const plansLayout = plansLayoutSelect ? plansLayoutSelect.value || 'adjacent' : 'adjacent';
    currentPlansLayout = plansLayout === 'list' ? 'list' : 'adjacent';

    const payload = { messages: validMessages, medias, plans, media_mode: mediaMode, plan_layout: plansLayout };
    
    const response = await fetch(`/api/admin/bots/${currentBotId}/config/start`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!result.success) {
      showAlert(result.error || 'Erro ao salvar', 'error');
      return;
    }

    showAlert('Configuração da mensagem /start salva com sucesso!', 'success');
    
    // Recarregar configuração
    loadBotConfig();
  } catch (error) {
    console.error('Erro ao salvar:', error);
    showAlert('Erro ao salvar: ' + error.message, 'error');
  }
}

window.previewStartMessage = async function previewStartMessage() {
  try {
    // Coletar mensagens do DOM (não usar estado global que pode estar desatualizado)
    const messages = getCurrentMessages();
    
    if (!messages || messages.length === 0) {
      showAlert('Adicione pelo menos uma mensagem para fazer preview', 'error');
      return;
    }
    
    // Garantir que todas as mensagens são strings válidas (NUNCA objetos)
    const validMessages = messages
      .map(msg => {
        if (typeof msg === 'string') return msg;
        if (typeof msg === 'object' && msg !== null && msg.text) return String(msg.text);
        if (msg === null || msg === undefined) return '';
        return String(msg);
      })
      .filter(msg => msg && msg.trim()); // Remover vazias
    
    if (validMessages.length === 0) {
      showAlert('Adicione pelo menos uma mensagem para fazer preview', 'error');
      return;
    }
    
    // Coletar mídias e planos do estado global
    const medias = currentMedias || [];
    const plans = currentPlans || [];
    
    // Coletar modo de envio de mídias
    const mediaMode = document.getElementById('mediaMode').value || 'group';
    const plansLayoutSelect = document.getElementById('plansLayout');
    const plansLayout = plansLayoutSelect ? plansLayoutSelect.value || 'adjacent' : 'adjacent';
    currentPlansLayout = plansLayout === 'list' ? 'list' : 'adjacent';

    const payload = { messages: validMessages, medias, plans, media_mode: mediaMode, plan_layout: plansLayout };
    
    // Mostrar loading
    showAlert('Enviando preview para o grupo de aquecimento...', 'info');
    
    const response = await fetch(`/api/admin/bots/${currentBotId}/start/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!result.success) {
      showAlert(`Erro no preview: ${result.error || 'Erro desconhecido'}`, 'error');
      console.error('Preview error details:', result);
      return;
    }

    showAlert('✓ Preview enviado com sucesso para o grupo de aquecimento!', 'success');
    console.log('Preview details:', result.data);
  } catch (error) {
    console.error('Erro ao fazer preview:', error);
    showAlert('Erro ao fazer preview: ' + error.message, 'error');
  }
}

window.openAddDownsellModal = function openAddDownsellModal() {
  document.getElementById('downsellForm').reset();
  document.getElementById('downsellId').value = '';
  document.getElementById('downsellModalTitle').textContent = 'Adicionar Downsell';
  
  // Resetar estado do downsell
  currentDownsellPlans = [];
  currentDownsellMedia = null;
  currentDownsellTrigger = 'start';
  
  // Resetar gatilho para /start
  selectDownsellTrigger('start');
  
  // Renderizar listas vazias
  renderDownsellPlans();
  renderDownsellMedia();
  
  document.getElementById('downsellModal').classList.add('active');
}

window.closeDownsellModal = function closeDownsellModal() {
  document.getElementById('downsellModal').classList.remove('active');
}

window.saveDownsell = async function saveDownsell(event) {
  event.preventDefault();

  console.log('[DOWNSELL][SAVE_START]', {
    currentDownsellPlans,
    currentDownsellMedia,
    currentDownsellTrigger
  });

  const downsellId = document.getElementById('downsellId').value;
  const slug = document.getElementById('downsellSlug').value.trim();
  const delay_minutes = parseInt(document.getElementById('downsellDelay').value, 10);
  const textContent = document.getElementById('downsellContent').value.trim();
  const active = document.getElementById('downsellActive').checked;
  const trigger_type = currentDownsellTrigger; // 'start' ou 'pix_created'

  if (!slug || !textContent) {
    showAlert('Slug e conteúdo são obrigatórios', 'error');
    return;
  }

  if (!delay_minutes || delay_minutes < 1) {
    showAlert('Delay deve ser pelo menos 1 minuto', 'error');
    return;
  }

  try {
    // Montar objeto do downsell
    const delay_seconds = delay_minutes * 60;
    
    // CORREÇÃO: Montar content como objeto JSON com text, medias e plans
    // (mesmo formato que /start usa)
    const contentObject = {
      text: textContent,
      medias: [],
      plans: currentDownsellPlans || [],
      media_mode: 'single', // Downsell suporta apenas 1 mídia
      attach_text_as_caption: false
    };

    // Adicionar mídia se existir (máximo 1 para downsell)
    if (currentDownsellMedia) {
      contentObject.medias.push({
        kind: currentDownsellMedia.kind || currentDownsellMedia.type,
        sha256: currentDownsellMedia.sha256 || currentDownsellMedia.key
      });
    }
    
    const downsellData = {
      id: downsellId || undefined,
      slug,
      content: contentObject, // ← Agora é objeto, não string!
      delay_seconds,
      active,
      trigger_type
    };

    const downsells = [downsellData];

    const response = await fetch(`/api/admin/bots/${currentBotId}/config/downsells`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downsells })
    });

    const result = await response.json();

    if (!result.success) {
      showAlert(result.error || 'Erro ao salvar', 'error');
      return;
    }

    showAlert('Downsell salvo com sucesso!', 'success');
    closeDownsellModal();
    loadBotConfig();
  } catch (error) {
    console.error('Erro ao salvar:', error);
    showAlert('Erro ao salvar: ' + error.message, 'error');
  }
}

window.editDownsell = function editDownsell(downsellId) {
  console.log('[editDownsell] CHAMADA - downsellId:', downsellId, 'tipo:', typeof downsellId);
  console.log('[editDownsell] currentConfig.downsells:', currentConfig.downsells);
  
  // Converter para número para garantir comparação correta
  const numericId = parseInt(downsellId, 10);
  const downsell = currentConfig.downsells.find(d => parseInt(d.id, 10) === numericId);
  
  if (!downsell) {
    console.error('[editDownsell] Downsell não encontrado! ID:', downsellId);
    console.error('[editDownsell] IDs disponíveis:', currentConfig.downsells.map(d => ({ id: d.id, tipo: typeof d.id })));
    showAlert('Downsell não encontrado', 'error');
    return;
  }
  
  console.log('[editDownsell] ✓ Downsell encontrado:', downsell);

  document.getElementById('downsellId').value = downsell.id;
  document.getElementById('downsellSlug').value = downsell.slug;
  
  // Converter segundos para minutos na UI
  const delay_minutes = Math.round(downsell.delay_seconds / 60);
  document.getElementById('downsellDelay').value = delay_minutes;
  
  // CORREÇÃO: Parsear content se for objeto JSON
  let contentText = '';
  let contentPlans = [];
  let contentMedias = [];
  
  if (typeof downsell.content === 'string') {
    try {
      const parsed = JSON.parse(downsell.content);
      contentText = parsed.text || downsell.content;
      contentPlans = parsed.plans || [];
      contentMedias = parsed.medias || [];
    } catch (e) {
      contentText = downsell.content;
    }
  } else if (typeof downsell.content === 'object' && downsell.content !== null) {
    contentText = downsell.content.text || '';
    contentPlans = downsell.content.plans || [];
    contentMedias = downsell.content.medias || [];
  }
  
  document.getElementById('downsellContent').value = contentText;
  document.getElementById('downsellActive').checked = downsell.active;
  
  // Carregar trigger_type (padrão: 'start' se não existir)
  currentDownsellTrigger = downsell.trigger_type || 'start';
  selectDownsellTrigger(currentDownsellTrigger);
  
  // Carregar planos do content
  currentDownsellPlans = Array.isArray(contentPlans) ? contentPlans : [];
  renderDownsellPlans();
  
  // Carregar mídia do content (primeira mídia se existir)
  if (contentMedias && contentMedias.length > 0) {
    currentDownsellMedia = contentMedias[0];
  } else {
    currentDownsellMedia = null;
  }
  renderDownsellMedia();
  
  document.getElementById('downsellModalTitle').textContent = 'Editar Downsell';
  document.getElementById('downsellModal').classList.add('active');
}

window.deleteDownsell = async function deleteDownsell(downsellId) {
  if (!confirm('Tem certeza que deseja deletar este downsell?')) return;

  try {
    const response = await fetch(`/api/admin/bots/${currentBotId}/config/downsells`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downsells: [] })
    });

    const result = await response.json();

    if (!result.success) {
      showAlert(result.error || 'Erro ao deletar', 'error');
      return;
    }

    showAlert('Downsell deletado com sucesso!', 'success');
    loadBotConfig();
  } catch (error) {
    console.error('Erro ao deletar:', error);
    showAlert('Erro ao deletar: ' + error.message, 'error');
  }
};

// ===== FUNÇÕES DE GERENCIAMENTO DO DOWNSELL =====

function selectDownsellTrigger(trigger) {
  currentDownsellTrigger = trigger;
  document.getElementById('downsellTrigger').value = trigger;
  
  // Atualizar visual dos botões
  document.querySelectorAll('.trigger-option').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.trigger === trigger) {
      btn.classList.add('active');
    }
  });
}

function addDownsellPlan() {
  if (currentDownsellPlans.length >= 10) {
    showAlert('Máximo 10 planos permitidos por downsell', 'error');
    return;
  }
  
  // Abrir modal de plano (reutilizar o modal existente de planos)
  openDownsellPlanModal();
}

function openDownsellPlanModal(editIndex = null) {
  // Criar um modal inline simples para adicionar plano
  const planName = editIndex !== null ? currentDownsellPlans[editIndex].name : '';
  const planTime = editIndex !== null ? currentDownsellPlans[editIndex].time : '';
  const planValue = editIndex !== null ? formatCurrency(currentDownsellPlans[editIndex].value) : '';
  
  const modalTitle = editIndex !== null ? 'Editar Plano' : 'Adicionar Plano';
  const modalHtml = `
    <div id="downsellPlanModalOverlay" class="modal active" style="z-index: 1100;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>${modalTitle}</h2>
          <button class="modal-close" onclick="closeDownsellPlanModal()">×</button>
        </div>
        <form id="downsellPlanForm" onsubmit="saveDownsellPlan(event, ${editIndex})">
          <div class="form-group">
            <label for="downsellPlanName">Nome do Plano *</label>
            <input type="text" id="downsellPlanName" placeholder="ex: Plano 7 dias" value="${planName}" required>
          </div>
          <div class="form-group">
            <label for="downsellPlanTime">Tempo/Duração *</label>
            <input type="text" id="downsellPlanTime" placeholder="ex: 7 dias, 30 dias" value="${planTime}" required>
          </div>
          <div class="form-group">
            <label for="downsellPlanValue">Valor (R$) *</label>
            <input type="text" id="downsellPlanValue" placeholder="ex: 29,90" value="${planValue}" required>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" onclick="closeDownsellPlanModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  // Remover modal anterior se existir
  const existingModal = document.getElementById('downsellPlanModalOverlay');
  if (existingModal) existingModal.remove();
  
  // Adicionar modal ao body
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeDownsellPlanModal() {
  const modal = document.getElementById('downsellPlanModalOverlay');
  if (modal) modal.remove();
}

function saveDownsellPlan(event, editIndex) {
  event.preventDefault();
  
  const name = document.getElementById('downsellPlanName').value.trim();
  const time = document.getElementById('downsellPlanTime').value.trim();
  const valueStr = document.getElementById('downsellPlanValue').value.trim();
  
  if (!name || !time || !valueStr) {
    showAlert('Todos os campos são obrigatórios', 'error');
    return;
  }
  
  const value = parseCurrency(valueStr);
  if (value <= 0) {
    showAlert('Valor deve ser maior que zero', 'error');
    return;
  }
  
  const plan = { name, time, value };
  
  if (editIndex !== null && editIndex >= 0) {
    currentDownsellPlans[editIndex] = plan;
  } else {
    currentDownsellPlans.push(plan);
  }
  
  renderDownsellPlans();
  closeDownsellPlanModal();
  showAlert('Plano adicionado!', 'success');
}

function editDownsellPlan(index) {
  openDownsellPlanModal(index);
}

function removeDownsellPlan(index) {
  if (!confirm('Remover este plano?')) return;
  currentDownsellPlans.splice(index, 1);
  renderDownsellPlans();
}

function renderDownsellPlans() {
  const container = document.getElementById('downsellPlansList');
  const addBtn = document.getElementById('addDownsellPlanBtn');
  
  if (currentDownsellPlans.length === 0) {
    container.innerHTML = '<div class="empty-state-small"><p>Nenhum plano configurado</p></div>';
    addBtn.style.display = 'inline-flex';
    return;
  }
  
  let html = '';
  currentDownsellPlans.forEach((plan, index) => {
    const valueFormatted = formatCurrency(plan.value);
    html += `
      <div class="downsell-plan-card">
        <div class="downsell-plan-info">
          <div class="downsell-plan-name">${plan.name}</div>
          <div class="downsell-plan-meta">Duração: ${plan.time} | Valor: ${valueFormatted}</div>
        </div>
        <div class="config-item-actions">
          <button type="button" class="btn-secondary btn-small" onclick="editDownsellPlan(${index})">Editar</button>
          <button type="button" class="btn-danger btn-small" onclick="removeDownsellPlan(${index})">Remover</button>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Controlar visibilidade do botão adicionar
  if (currentDownsellPlans.length >= 10) {
    addBtn.style.display = 'none';
  } else {
    addBtn.style.display = 'inline-flex';
  }
}

function selectDownsellMedia() {
  if (currentDownsellMedia) {
    showAlert('Já existe uma mídia selecionada. Remova-a primeiro.', 'warning');
    return;
  }
  
  // Abrir modal de seleção de mídia (reutilizar o modal existente)
  // Por enquanto, vamos criar um modal simples que lista as mídias disponíveis
  openDownsellMediaSelector();
}

function openDownsellMediaSelector() {
  // Buscar mídias disponíveis do bot
  const medias = currentMedias || [];
  
  if (medias.length === 0) {
    showAlert('Nenhuma mídia disponível. Adicione mídias na aba "Mensagem /start" primeiro.', 'warning');
    return;
  }
  
  let mediasHtml = '';
  medias.forEach((media, index) => {
    const typeIcons = { photo: '📷', video: '🎥', audio: '🎵', document: '📄' };
    const mediaType = String(media.type || media.kind || 'document');
    const mediaName = String(media.name || `Mídia ${index + 1}`);
    const icon = typeIcons[mediaType] || '📄';
    
    mediasHtml += `
      <div class="media-selector-item" onclick="selectMediaForDownsell(${index})">
        <div class="media-icon">${icon}</div>
        <div class="media-info">
          <div class="media-name">${mediaName}</div>
          <div class="media-type">${mediaType}</div>
        </div>
      </div>
    `;
  });
  
  const modalHtml = `
    <div id="downsellMediaSelectorOverlay" class="modal active" style="z-index: 1100;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Selecionar Mídia</h2>
          <button class="modal-close" onclick="closeDownsellMediaSelector()">×</button>
        </div>
        <div style="max-height: 400px; overflow-y: auto;">
          ${mediasHtml}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" onclick="closeDownsellMediaSelector()">Cancelar</button>
        </div>
      </div>
    </div>
  `;
  
  // Remover modal anterior se existir
  const existingModal = document.getElementById('downsellMediaSelectorOverlay');
  if (existingModal) existingModal.remove();
  
  // Adicionar modal ao body
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  // Adicionar estilos inline para os itens de mídia
  const style = document.createElement('style');
  style.textContent = `
    .media-selector-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .media-selector-item:hover {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }
  `;
  document.head.appendChild(style);
}

function closeDownsellMediaSelector() {
  const modal = document.getElementById('downsellMediaSelectorOverlay');
  if (modal) modal.remove();
}

function selectMediaForDownsell(mediaIndex) {
  const medias = currentMedias || [];
  if (mediaIndex < 0 || mediaIndex >= medias.length) return;
  
  currentDownsellMedia = medias[mediaIndex];
  renderDownsellMedia();
  closeDownsellMediaSelector();
  showAlert('Mídia selecionada!', 'success');
}

function removeDownsellMedia() {
  if (!confirm('Remover esta mídia?')) return;
  currentDownsellMedia = null;
  renderDownsellMedia();
}

function renderDownsellMedia() {
  const container = document.getElementById('downsellMediaPreview');
  const selectBtn = document.getElementById('selectDownsellMediaBtn');
  
  if (!currentDownsellMedia) {
    container.innerHTML = '<div class="empty-state-small"><p>Nenhuma mídia selecionada</p></div>';
    selectBtn.style.display = 'inline-flex';
    return;
  }
  
  const typeIcons = { photo: '📷', video: '🎥', audio: '🎵', document: '📄' };
  const mediaType = String(currentDownsellMedia.type || currentDownsellMedia.kind || 'document');
  const mediaName = String(currentDownsellMedia.name || 'Mídia');
  const icon = typeIcons[mediaType] || '📄';
  
  container.innerHTML = `
    <div class="downsell-media-card">
      <div class="downsell-media-icon">${icon}</div>
      <div class="downsell-media-info">
        <div class="downsell-media-name">${mediaName}</div>
        <div class="downsell-media-type">${mediaType}</div>
      </div>
      <button type="button" class="btn-danger btn-small" onclick="removeDownsellMedia()">Remover</button>
    </div>
  `;
  
  // Ocultar botão de selecionar quando já tem mídia
  selectBtn.style.display = 'none';
}

// ===== FIM DAS FUNÇÕES DE GERENCIAMENTO DO DOWNSELL =====

function openAddShotModal() {
  document.getElementById('shotForm').reset();
  document.getElementById('shotId').value = '';
  document.getElementById('shotModalTitle').textContent = 'Adicionar Shot';
  
  // Resetar estado do shot
  currentShotPlans = [];
  currentShotMedia = null;
  currentShotTrigger = 'start';
  currentShotScheduleType = 'immediate';
  
  // Resetar gatilho e tipo de disparo
  selectShotTrigger('start');
  selectShotScheduleType('immediate');
  
  // Renderizar listas vazias
  renderShotPlans();
  renderShotMedia();
  
  // Ocultar campos de agendamento
  document.getElementById('shotScheduleFields').style.display = 'none';
  
  document.getElementById('shotModal').classList.add('active');
}

function closeShotModal() {
  document.getElementById('shotModal').classList.remove('active');
}

async function saveShot(event) {
  event.preventDefault();

  console.log('[SHOT][SAVE_START]', {
    currentShotMedia,
    currentShotPlans,
    currentShotTrigger,
    currentShotScheduleType
  });

  const shotId = document.getElementById('shotId').value;
  const slug = document.getElementById('shotSlug').value.trim();
  const textContent = document.getElementById('shotContent').value.trim();
  const filter_criteria = document.getElementById('shotFilter').value.trim();
  const active = document.getElementById('shotActive').checked;
  const trigger_type = currentShotTrigger;
  const schedule_type = currentShotScheduleType;

  if (!slug || !textContent) {
    showAlert('Slug e conteúdo são obrigatórios', 'error');
    return;
  }

  // Validar agendamento se for scheduled
  let scheduled_at = null;
  if (schedule_type === 'scheduled') {
    const scheduleDate = document.getElementById('shotScheduleDate').value;
    const scheduleTime = document.getElementById('shotScheduleTime').value;
    
    if (!scheduleDate || !scheduleTime) {
      showAlert('Data e horário são obrigatórios para disparo agendado', 'error');
      return;
    }
    
    // Combinar data e hora garantindo timezone local
    // Separar componentes de data e hora para criar Date de forma consistente
    const [year, month, day] = scheduleDate.split('-').map(Number);
    const [hours, minutes] = scheduleTime.split(':').map(Number);
    
    // Criar Date no timezone local do navegador
    const localDateTime = new Date(year, month - 1, day, hours, minutes, 0);
    
    // Converter para string ISO UTC para salvar no banco
    scheduled_at = localDateTime.toISOString();
    
    console.log('[SHOT][SCHEDULE_TIME]', {
      userInput: `${scheduleDate}T${scheduleTime}:00`,
      dateComponents: { year, month, day, hours, minutes },
      localTime: localDateTime.toString(),
      utcTime: scheduled_at,
      timezoneOffset: localDateTime.getTimezoneOffset()
    });
  }

  try {
    // Montar objeto content como JSON (mesmo formato do downsell)
    const contentObject = {
      text: textContent,
      medias: [],
      plans: currentShotPlans || [],
      media_mode: 'single', // Shot suporta apenas 1 mídia
      attach_text_as_caption: false
    };

    // Adicionar mídia se existir (máximo 1 para shot)
    if (currentShotMedia) {
      contentObject.medias.push({
        kind: currentShotMedia.kind || currentShotMedia.type,
        sha256: currentShotMedia.sha256 || currentShotMedia.key
      });
    }

    const shotData = {
      id: shotId || undefined,
      slug,
      content: contentObject,
      filter_criteria: filter_criteria || null,
      active,
      trigger_type,
      schedule_type,
      scheduled_at
    };

    console.log('[SHOT][SAVE_DEBUG]', {
      slug,
      textContent: textContent.substring(0, 50),
      plansCount: currentShotPlans.length,
      mediasCount: contentObject.medias.length,
      currentShotPlans,
      currentShotMedia,
      contentObject
    });
    
    console.log('[SHOT][SAVE_PAYLOAD]', JSON.stringify(shotData, null, 2));

    const shots = [shotData];

    console.log('[SHOT][BEFORE_FETCH]', {
      currentShotMedia,
      contentObjectMedias: contentObject.medias,
      shotDataContent: shotData.content
    });

    const response = await fetch(`/api/admin/bots/${currentBotId}/config/shots`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shots })
    });

    const result = await response.json();

    if (!result.success) {
      showAlert(result.error || 'Erro ao salvar', 'error');
      return;
    }

    const isImmediate = currentShotScheduleType === 'immediate';
    
    showAlert('Shot salvo com sucesso!', 'success');
    closeShotModal();
    loadBotConfig();
    
    // Se shot é imediato, recarregar UI após alguns segundos para refletir deleção
    if (isImmediate) {
      console.log('[SHOT][AUTO_RELOAD] Shot imediato criado, recarregando em 3s...');
      setTimeout(() => {
        console.log('[SHOT][AUTO_RELOAD] Recarregando configuração...');
        loadBotConfig();
      }, 3000);
    }
  } catch (error) {
    console.error('Erro ao salvar:', error);
    showAlert('Erro ao salvar: ' + error.message, 'error');
  }
}

window.editShot = function editShot(shotId) {
  console.log('[SHOT][EDIT_CLICKED]', { shotId, type: typeof shotId, shots: currentConfig.shots });
  
  // Normalizar shotId para number
  const normalizedId = typeof shotId === 'string' ? parseInt(shotId, 10) : shotId;
  
  const shot = currentConfig.shots.find(s => s.id === normalizedId);
  if (!shot) {
    console.error('[SHOT][EDIT_ERROR]', { shotId, normalizedId, reason: 'shot_not_found' });
    showAlert('Shot não encontrado', 'error');
    return;
  }
  
  console.log('[SHOT][EDIT_FOUND]', { shotId: shot.id, slug: shot.slug });

  document.getElementById('shotId').value = shot.id;
  document.getElementById('shotSlug').value = shot.slug;
  
  // CORREÇÃO: Parsear content se for objeto JSON
  let contentText = '';
  let contentPlans = [];
  let contentMedias = [];
  
  if (typeof shot.content === 'string') {
    try {
      const parsed = JSON.parse(shot.content);
      contentText = parsed.text || shot.content;
      contentPlans = parsed.plans || [];
      contentMedias = parsed.medias || [];
    } catch (e) {
      contentText = shot.content;
    }
  } else if (typeof shot.content === 'object' && shot.content !== null) {
    contentText = shot.content.text || '';
    contentPlans = shot.content.plans || [];
    contentMedias = shot.content.medias || [];
  }
  
  document.getElementById('shotContent').value = contentText;
  document.getElementById('shotFilter').value = shot.filter_criteria || '';
  document.getElementById('shotActive').checked = shot.active;
  
  // Carregar trigger_type (padrão: 'start' se não existir)
  currentShotTrigger = shot.trigger_type || 'start';
  selectShotTrigger(currentShotTrigger);
  
  // Carregar schedule_type e scheduled_at
  currentShotScheduleType = shot.schedule_type || 'immediate';
  selectShotScheduleType(currentShotScheduleType);
  
  if (currentShotScheduleType === 'scheduled' && shot.scheduled_at) {
    // Parsear scheduled_at (vem em UTC, converter para local)
    const dateTime = new Date(shot.scheduled_at);
    
    // Converter para horário local
    const year = dateTime.getFullYear();
    const month = String(dateTime.getMonth() + 1).padStart(2, '0');
    const day = String(dateTime.getDate()).padStart(2, '0');
    const hours = String(dateTime.getHours()).padStart(2, '0');
    const minutes = String(dateTime.getMinutes()).padStart(2, '0');
    
    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hours}:${minutes}`;
    
    document.getElementById('shotScheduleDate').value = dateStr;
    populateShotTimeOptions(dateStr);
    document.getElementById('shotScheduleTime').value = timeStr;
    
    console.log('[SHOT][LOAD_SCHEDULE_TIME]', {
      utcTime: shot.scheduled_at,
      localDate: dateStr,
      localTime: timeStr
    });
  }
  
  // Carregar planos do content
  currentShotPlans = Array.isArray(contentPlans) ? contentPlans : [];
  renderShotPlans();
  
  // Carregar mídia do content (primeira mídia se existir)
  if (contentMedias && contentMedias.length > 0) {
    const savedMedia = contentMedias[0];
    // Buscar a mídia completa da lista de mídias disponíveis usando sha256
    const fullMedia = currentMedias?.find(m => 
      (m.sha256 === savedMedia.sha256 || m.key === savedMedia.sha256) &&
      (m.kind === savedMedia.kind || m.type === savedMedia.kind)
    );
    currentShotMedia = fullMedia || savedMedia;
  } else {
    currentShotMedia = null;
  }
  renderShotMedia();
  
  document.getElementById('shotModalTitle').textContent = 'Editar Shot';
  document.getElementById('shotModal').classList.add('active');
}

window.deleteShot = async function deleteShot(shotId) {
  if (!confirm('Tem certeza que deseja deletar este shot?')) return;

  try {
    const response = await fetch(`/api/admin/bots/${currentBotId}/config/shots/${shotId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();

    if (!result.success) {
      showAlert(result.error || 'Erro ao deletar', 'error');
      return;
    }

    showAlert('Shot deletado com sucesso!', 'success');
    loadBotConfig();
  } catch (error) {
    console.error('Erro ao deletar:', error);
    showAlert('Erro ao deletar: ' + error.message, 'error');
  }
}

// ===== FUNÇÕES DE GERENCIAMENTO DO SHOT =====

function selectShotTrigger(trigger) {
  currentShotTrigger = trigger;
  document.getElementById('shotTrigger').value = trigger;
  
  // Atualizar visual dos botões
  document.querySelectorAll('.trigger-option').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.trigger === trigger) {
      btn.classList.add('active');
    }
  });
}

function selectShotScheduleType(scheduleType) {
  currentShotScheduleType = scheduleType;
  document.getElementById('shotScheduleType').value = scheduleType;
  
  // Atualizar visual dos botões
  document.querySelectorAll('.schedule-option').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.schedule === scheduleType) {
      btn.classList.add('active');
    }
  });
  
  // Mostrar/ocultar campos de agendamento
  const scheduleFields = document.getElementById('shotScheduleFields');
  if (scheduleType === 'scheduled') {
    scheduleFields.style.display = 'block';
    
    // Configurar data mínima (hoje)
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('shotScheduleDate').setAttribute('min', today);
    
    // Listener para atualizar horários quando data mudar
    const dateInput = document.getElementById('shotScheduleDate');
    dateInput.removeEventListener('change', handleShotDateChange);
    dateInput.addEventListener('change', handleShotDateChange);
    
    // Popular horários se já houver data selecionada
    if (dateInput.value) {
      populateShotTimeOptions(dateInput.value);
    }
  } else {
    scheduleFields.style.display = 'none';
  }
}

function handleShotDateChange(event) {
  const selectedDate = event.target.value;
  populateShotTimeOptions(selectedDate);
}

function populateShotTimeOptions(selectedDate) {
  const timeSelect = document.getElementById('shotScheduleTime');
  const today = new Date().toISOString().split('T')[0];
  const isToday = selectedDate === today;
  
  // Limpar opções existentes
  timeSelect.innerHTML = '<option value="">Selecione o horário</option>';
  
  // Gerar horários de 5 em 5 minutos
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 5) {
      // Se for hoje, pular horários passados
      if (isToday) {
        if (hour < currentHour || (hour === currentHour && minute <= currentMinute)) {
          continue;
        }
      }
      
      const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      const option = document.createElement('option');
      option.value = timeStr;
      option.textContent = timeStr;
      timeSelect.appendChild(option);
    }
  }
}

function addShotPlan() {
  if (currentShotPlans.length >= 10) {
    showAlert('Máximo 10 planos permitidos por shot', 'error');
    return;
  }
  
  openShotPlanModal();
}

function openShotPlanModal(editIndex = null) {
  const planName = editIndex !== null ? currentShotPlans[editIndex].name : '';
  const planTime = editIndex !== null ? currentShotPlans[editIndex].time : '';
  const planValue = editIndex !== null ? formatCurrency(currentShotPlans[editIndex].value) : '';
  
  const modalTitle = editIndex !== null ? 'Editar Plano' : 'Adicionar Plano';
  
  const modalHtml = `
    <div id="shotPlanModalOverlay" class="modal active" style="z-index: 1100;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>${modalTitle}</h2>
          <button class="modal-close" onclick="closeShotPlanModal()">×</button>
        </div>
        <form id="shotPlanForm" onsubmit="saveShotPlan(event, ${editIndex})">
          <div class="form-group">
            <label for="shotPlanName">Nome do Plano *</label>
            <input type="text" id="shotPlanName" placeholder="ex: Plano 7 dias" value="${planName}" required>
          </div>
          <div class="form-group">
            <label for="shotPlanTime">Tempo/Duração *</label>
            <input type="text" id="shotPlanTime" placeholder="ex: 7 dias, 30 dias" value="${planTime}" required>
          </div>
          <div class="form-group">
            <label for="shotPlanValue">Valor (R$) *</label>
            <input type="text" id="shotPlanValue" placeholder="ex: 29,90" value="${planValue}" required>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" onclick="closeShotPlanModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  const existingModal = document.getElementById('shotPlanModalOverlay');
  if (existingModal) existingModal.remove();
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeShotPlanModal() {
  const modal = document.getElementById('shotPlanModalOverlay');
  if (modal) modal.remove();
}

function saveShotPlan(event, editIndex) {
  event.preventDefault();
  
  const name = document.getElementById('shotPlanName').value.trim();
  const time = document.getElementById('shotPlanTime').value.trim();
  const valueStr = document.getElementById('shotPlanValue').value.trim();
  
  if (!name || !time || !valueStr) {
    showAlert('Todos os campos são obrigatórios', 'error');
    return;
  }
  
  const value = parseCurrency(valueStr);
  if (value <= 0) {
    showAlert('Valor deve ser maior que zero', 'error');
    return;
  }
  
  const plan = { name, time, value };
  
  if (editIndex !== null && editIndex >= 0) {
    currentShotPlans[editIndex] = plan;
  } else {
    currentShotPlans.push(plan);
  }
  
  renderShotPlans();
  closeShotPlanModal();
  showAlert('Plano adicionado!', 'success');
}

function editShotPlan(index) {
  openShotPlanModal(index);
}

function removeShotPlan(index) {
  if (!confirm('Remover este plano?')) return;
  currentShotPlans.splice(index, 1);
  renderShotPlans();
}

function renderShotPlans() {
  const container = document.getElementById('shotPlansList');
  const addBtn = document.getElementById('addShotPlanBtn');
  
  if (currentShotPlans.length === 0) {
    container.innerHTML = '<div class="empty-state-small"><p>Nenhum plano configurado</p></div>';
    addBtn.style.display = 'inline-flex';
    return;
  }
  
  let html = '';
  currentShotPlans.forEach((plan, index) => {
    const valueFormatted = formatCurrency(plan.value);
    html += `
      <div class="downsell-plan-card">
        <div class="downsell-plan-info">
          <div class="downsell-plan-name">${plan.name}</div>
          <div class="downsell-plan-meta">Duração: ${plan.time} | Valor: ${valueFormatted}</div>
        </div>
        <div class="config-item-actions">
          <button type="button" class="btn-secondary btn-small" onclick="editShotPlan(${index})">Editar</button>
          <button type="button" class="btn-danger btn-small" onclick="removeShotPlan(${index})">Remover</button>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  if (currentShotPlans.length >= 10) {
    addBtn.style.display = 'none';
  } else {
    addBtn.style.display = 'inline-flex';
  }
}

function selectShotMedia() {
  if (currentShotMedia) {
    showAlert('Já existe uma mídia selecionada. Remova-a primeiro.', 'warning');
    return;
  }
  
  openShotMediaSelector();
}

function openShotMediaSelector() {
  const medias = currentMedias || [];
  
  if (medias.length === 0) {
    showAlert('Nenhuma mídia disponível. Adicione mídias na aba "Mensagem /start" primeiro.', 'warning');
    return;
  }
  
  let mediasHtml = '';
  medias.forEach((media, index) => {
    const typeIcons = { photo: '📷', video: '🎥', audio: '🎵', document: '📄' };
    const mediaType = String(media.type || media.kind || 'document');
    const mediaName = String(media.name || `Mídia ${index + 1}`);
    const icon = typeIcons[mediaType] || '📄';
    
    mediasHtml += `
      <div class="media-selector-item" onclick="selectMediaForShot(${index})">
        <div class="media-icon">${icon}</div>
        <div class="media-info">
          <div class="media-name">${mediaName}</div>
          <div class="media-type">${mediaType}</div>
        </div>
      </div>
    `;
  });
  
  const modalHtml = `
    <div id="shotMediaSelectorOverlay" class="modal active" style="z-index: 1100;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Selecionar Mídia</h2>
          <button class="modal-close" onclick="closeShotMediaSelector()">×</button>
        </div>
        <div style="max-height: 400px; overflow-y: auto;">
          ${mediasHtml}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" onclick="closeShotMediaSelector()">Cancelar</button>
        </div>
      </div>
    </div>
  `;
  
  const existingModal = document.getElementById('shotMediaSelectorOverlay');
  if (existingModal) existingModal.remove();
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  const style = document.createElement('style');
  style.textContent = `
    .media-selector-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .media-selector-item:hover {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }
  `;
  document.head.appendChild(style);
}

function closeShotMediaSelector() {
  console.log('[SHOT][CLOSE_MEDIA_SELECTOR]', {
    currentShotMediaBefore: currentShotMedia
  });
  const modal = document.getElementById('shotMediaSelectorOverlay');
  if (modal) modal.remove();
}

function selectMediaForShot(mediaIndex) {
  const medias = currentMedias || [];
  if (mediaIndex < 0 || mediaIndex >= medias.length) return;
  
  currentShotMedia = medias[mediaIndex];
  
  console.log('[SHOT][SELECT_MEDIA]', {
    mediaIndex,
    selectedMedia: currentShotMedia,
    mediaType: currentShotMedia.type || currentShotMedia.kind,
    mediaName: currentShotMedia.name,
    mediaSha256: currentShotMedia.sha256 || currentShotMedia.key
  });
  
  renderShotMedia();
  closeShotMediaSelector();
  showAlert('Mídia selecionada!', 'success');
}

function removeShotMedia() {
  if (!confirm('Remover esta mídia?')) return;
  currentShotMedia = null;
  renderShotMedia();
}

function renderShotMedia() {
  console.log('[SHOT][RENDER_MEDIA]', {
    currentShotMedia,
    hasMedia: !!currentShotMedia
  });
  
  const container = document.getElementById('shotMediaPreview');
  const selectBtn = document.getElementById('selectShotMediaBtn');
  
  if (!currentShotMedia) {
    container.innerHTML = '<div class="empty-state-small"><p>Nenhuma mídia selecionada</p></div>';
    selectBtn.style.display = 'inline-flex';
    return;
  }
  
  const typeIcons = { photo: '📷', video: '🎥', audio: '🎵', document: '📄' };
  const mediaType = String(currentShotMedia.type || currentShotMedia.kind || 'document');
  const mediaName = String(currentShotMedia.name || 'Mídia');
  const icon = typeIcons[mediaType] || '📄';
  
  container.innerHTML = `
    <div class="downsell-media-card">
      <div class="downsell-media-icon">${icon}</div>
      <div class="downsell-media-info">
        <div class="downsell-media-name">${mediaName}</div>
        <div class="downsell-media-type">${mediaType}</div>
      </div>
      <button type="button" class="btn-danger btn-small" onclick="removeShotMedia()">Remover</button>
    </div>
  `;
  
  selectBtn.style.display = 'none';
}

// ===== FIM DAS FUNÇÕES DE GERENCIAMENTO DO SHOT =====

function showAlert(message, type = 'success') {
  const alertsContainer = document.getElementById('alerts');
  const alertId = 'alert-' + Date.now();

  const alertHtml = `
    <div class="alert alert-${type}" id="${alertId}">
      <span>${message}</span>
      <button class="alert-close" onclick="document.getElementById('${alertId}').remove()">×</button>
    </div>
  `;

  alertsContainer.innerHTML += alertHtml;

  setTimeout(() => {
    const alert = document.getElementById(alertId);
    if (alert) alert.remove();
  }, 5000);
}

// ===== FUNÇÕES DE GERENCIAMENTO DE MENSAGENS =====

let currentMessages = [];
let currentMedias = [];
let currentPlans = [];

function addMessage() {
  const messages = getCurrentMessages();
  if (messages.length >= 3) {
    showAlert('Máximo 3 mensagens permitidas', 'error');
    return;
  }
  
  messages.push('');
  renderMessages(messages);
  
  // Focar no novo textarea
  const newTextarea = document.querySelector('#messagesList .config-item-card:last-child textarea');
  if (newTextarea) {
    newTextarea.focus();
  }
}

function removeMessage(index) {
  const messages = getCurrentMessages();
  messages.splice(index, 1);
  renderMessages(messages);
}

function updateCharCounter(textarea, index) {
  const charCount = textarea.value.length;
  let counter = textarea.parentNode.querySelector('.char-counter');
  
  // Se o contador não existe, criar
  if (!counter) {
    counter = document.createElement('div');
    counter.className = 'char-counter';
    textarea.parentNode.appendChild(counter);
  }
  
  counter.textContent = `${charCount} caracteres`;
}

function getCurrentMessages() {
  const messages = [];
  document.querySelectorAll('#messagesList .config-item-card textarea').forEach(textarea => {
    const value = textarea.value.trim();
    // Garantir que apenas strings não-vazias são adicionadas
    if (value) {
      messages.push(value);
    }
  });
  return messages;
}

// ===== FUNÇÕES DE GERENCIAMENTO DE MÍDIAS =====

function addMedia() {
  const medias = getCurrentMedias();
  if (medias.length >= 3) {
    showAlert('Máximo 3 mídias permitidas', 'error');
    return;
  }
  
  openMediaModal();
}

function removeMedia(index) {
  currentMedias.splice(index, 1);
  renderMedias(currentMedias);
}

function getCurrentMedias() {
  return currentMedias;
}

function openMediaModal() {
  document.getElementById('mediaForm').reset();
  document.getElementById('mediaModal').classList.add('active');
}

function closeMediaModal() {
  document.getElementById('mediaModal').classList.remove('active');
}

async function saveMedia(event) {
  event.preventDefault();
  
  const type = document.getElementById('mediaType').value;
  const file = document.getElementById('mediaFile').files[0];
  const caption = document.getElementById('mediaCaption').value.trim();
  
  if (!type || !file) {
    showAlert('Tipo e arquivo são obrigatórios', 'error');
    return;
  }
  
  // Mostrar loading
  showAlert('Processando mídia...', 'info');
  
  try {
    // Criar FormData para upload
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    formData.append('caption', caption);
    
    // Enviar para backend para warmup
    const response = await fetch(`/api/admin/bots/${currentBotId}/media/upload`, {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    
    if (!result.success) {
      showAlert(`Erro ao processar mídia: ${result.error || 'Erro desconhecido'}`, 'error');
      return;
    }
    
    // Adicionar mídia ao estado com shape canônico: { kind, key, caption }
    // Campos adicionais (name, size, tg_file_id, warmup_status) são apenas para UI
    const media = {
      // Shape canônico para backend
      kind: type,
      key: result.data.media_key, // sha256 ou identificador único
      caption: caption || '',
      
      // Campos adicionais para UI
      name: file.name,
      size: file.size,
      tg_file_id: result.data.tg_file_id || null,
      warmup_status: result.data.warmup_status || 'pending'
    };
    
    currentMedias.push(media);
    renderMedias(currentMedias);
    closeMediaModal();
    
    if (result.data.warmup_status === 'ready') {
      showAlert('✓ Mídia adicionada e aquecida com sucesso!', 'success');
    } else {
      showAlert('⚠️ Mídia adicionada, mas warmup não foi possível. Configure o grupo de aquecimento.', 'warning');
    }
  } catch (error) {
    console.error('Erro ao salvar mídia:', error);
    showAlert('Erro ao salvar mídia: ' + error.message, 'error');
  }
}

// ===== FUNÇÕES DE GERENCIAMENTO DE PLANOS =====

window.addPlan = function addPlan() {
  const plans = getCurrentPlans();
  if (plans.length >= 10) {
    showAlert('Máximo 10 planos permitidos', 'error');
    return;
  }
  
  openPlanModal();
};

window.editPlan = function editPlan(index) {
  console.log('[editPlan] CHAMADA - índice:', index, 'currentPlans:', currentPlans);
  
  try {
    const plan = currentPlans[index];
    if (!plan) {
      console.warn('[editPlan] Plano não encontrado no índice:', index);
      showAlert('Plano não encontrado', 'error');
      return;
    }
    
    console.log('[editPlan] Plano encontrado:', plan);
    
    const planModal = document.getElementById('planModal');
    if (!planModal) {
      console.error('[editPlan] Modal planModal não encontrado no DOM');
      showAlert('Erro: Modal de plano não encontrado', 'error');
      return;
    }
    
    console.log('[editPlan] Modal encontrado, preenchendo campos...');
    
    // Preencher campos um por um com try-catch
    try {
      document.getElementById('planIndex').value = index;
      console.log('[editPlan] ✓ planIndex preenchido');
    } catch (e) {
      console.error('[editPlan] Erro ao preencher planIndex:', e);
    }
    
    try {
      document.getElementById('planName').value = plan.name;
      console.log('[editPlan] ✓ planName preenchido:', plan.name);
    } catch (e) {
      console.error('[editPlan] Erro ao preencher planName:', e);
    }
    
    try {
      document.getElementById('planTime').value = plan.time;
      console.log('[editPlan] ✓ planTime preenchido:', plan.time);
    } catch (e) {
      console.error('[editPlan] Erro ao preencher planTime:', e);
    }
    
    try {
      const formattedValue = formatCurrency(plan.value);
      console.log('[editPlan] Valor formatado:', formattedValue);
      document.getElementById('planValue').value = formattedValue;
      console.log('[editPlan] ✓ planValue preenchido');
    } catch (e) {
      console.error('[editPlan] Erro ao preencher planValue:', e);
    }
    
    try {
      document.getElementById('planModalTitle').textContent = 'Editar Plano';
      console.log('[editPlan] ✓ planModalTitle preenchido');
    } catch (e) {
      console.error('[editPlan] Erro ao preencher planModalTitle:', e);
    }
    
    try {
      planModal.classList.add('active');
      console.log('[editPlan] ✓ Modal aberto com classe active');
    } catch (e) {
      console.error('[editPlan] Erro ao adicionar classe active:', e);
    }
    
    console.log('[editPlan] ✓ Processo completo');
  } catch (error) {
    console.error('[editPlan] ERRO GERAL:', error);
    showAlert('Erro ao abrir modal: ' + error.message, 'error');
  }
};

window.removePlan = function removePlan(index) {
  if (!confirm('Tem certeza que deseja remover este plano?')) return;
  
  currentPlans.splice(index, 1);
  renderPlans(currentPlans);
};

function getCurrentPlans() {
  return currentPlans;
}

window.openPlanModal = function openPlanModal() {
  document.getElementById('planForm').reset();
  document.getElementById('planIndex').value = '';
  document.getElementById('planModalTitle').textContent = 'Adicionar Plano';
  document.getElementById('planModal').classList.add('active');
};

window.closePlanModal = function closePlanModal() {
  document.getElementById('planModal').classList.remove('active');
};

window.savePlan = async function savePlan(event) {
  event.preventDefault();
  
  const index = document.getElementById('planIndex').value;
  const name = document.getElementById('planName').value.trim();
  const time = document.getElementById('planTime').value.trim();
  const valueStr = document.getElementById('planValue').value.trim();
  
  if (!name || !time || !valueStr) {
    showAlert('Todos os campos são obrigatórios', 'error');
    return;
  }
  
  // Converter valor para centavos
  const value = parseCurrency(valueStr);
  if (value <= 0) {
    showAlert('Valor deve ser maior que zero', 'error');
    return;
  }
  
  const plan = { name, time, value };
  
  if (index !== '') {
    // Editar
    currentPlans[parseInt(index)] = plan;
  } else {
    // Adicionar
    currentPlans.push(plan);
  }
  
  renderPlans(currentPlans);
  closePlanModal();
  
  showAlert('Plano salvo com sucesso!', 'success');
}

// ===== FUNÇÕES AUXILIARES =====

function formatCurrency(valueInCents) {
  if (typeof valueInCents === 'string') {
    // Se já estiver formatado, retornar como está
    return valueInCents;
  }
  return `R$ ${(valueInCents / 100).toFixed(2).replace('.', ',')}`;
}

function parseCurrency(valueStr) {
  // Remove R$, espaços e converte vírgula para ponto
  const cleanValue = valueStr.replace(/[R$\s]/g, '').replace(',', '.');
  const floatValue = parseFloat(cleanValue);
  
  if (isNaN(floatValue)) return 0;
  
  // Converter para centavos
  return Math.round(floatValue * 100);
}

// Inicializar estados quando carregar configuração
function initializeStartConfig(startConfig) {
  if (!startConfig) {
    currentMessages = [];
    currentMedias = [];
    currentPlans = [];
    currentMediaMode = 'group';
    currentPlansLayout = 'adjacent';
    return;
  }

  // Garantir que messages é sempre um array de strings (NUNCA objetos)
  if (Array.isArray(startConfig.messages)) {
    currentMessages = startConfig.messages
      .map(msg => {
        // Converter qualquer coisa para string
        if (typeof msg === 'string') return msg;
        if (typeof msg === 'object' && msg !== null && msg.text) return String(msg.text);
        if (msg === null || msg === undefined) return '';
        return String(msg);
      })
      .filter(msg => msg && msg.trim()); // Remover vazias
  } else if (startConfig.text_messages && Array.isArray(startConfig.text_messages)) {
    // Suporte a formato alternativo
    currentMessages = startConfig.text_messages
      .map(msg => typeof msg === 'string' ? msg : String(msg || ''))
      .filter(msg => msg && msg.trim());
  } else {
    currentMessages = [];
  }

  // Garantir que medias é um array com 'kind' normalizado
  if (Array.isArray(startConfig.medias)) {
    currentMedias = startConfig.medias.map(media => ({
      ...media,
      kind: media.kind || media.type, // Normalizar 'kind' se não existir
      type: media.type || media.kind  // Manter 'type' para compatibilidade
    }));
  } else {
    currentMedias = [];
  }

  // Garantir que plans é um array
  currentPlans = Array.isArray(startConfig.plans) ? startConfig.plans : [];

  // Carregar media_mode (padrão: 'group' para retrocompatibilidade)
  currentMediaMode = startConfig.media_mode || 'group';
  if (startConfig.plan_layout === 'list' || startConfig.planLayout === 'list') {
    currentPlansLayout = 'list';
  } else {
    currentPlansLayout = 'adjacent';
  }
}

// Atualizar função renderStartMessage para inicializar estados
function renderStartMessage() {
  const startConfig = currentConfig.startMessage;
  initializeStartConfig(startConfig);
  
  // Renderizar mensagens
  renderMessages(currentMessages);
  
  // Renderizar mídias
  renderMedias(currentMedias);
  
  // Renderizar planos
  renderPlans(currentPlans);
  
  // Restaurar media_mode no seletor
  const mediaModeSelect = document.getElementById('mediaMode');
  if (mediaModeSelect) {
    mediaModeSelect.value = currentMediaMode;
    updateMediaModeDisplay();
  }

  const plansLayoutSelect = document.getElementById('plansLayout');
  if (plansLayoutSelect) {
    plansLayoutSelect.value = currentPlansLayout;
    updatePlansLayout();
  }
}

// ============================================
// Funções da Tab Controle (KPIs)
// ============================================

window.loadControlKPIs = async function loadControlKPIs() {
  const container = document.getElementById('kpiCardsContainer');
  const errorState = document.getElementById('kpiErrorState');
  const periodSelect = document.getElementById('controlPeriod');
  const botSlugSpan = document.getElementById('controlBotSlug');

  // Mostrar loading
  container.innerHTML = `
    <div class="kpi-card kpi-loading">
      <div class="spinner"></div>
      <p>Carregando KPIs...</p>
    </div>
  `;
  errorState.style.display = 'none';

  // Atualizar slug do bot no título
  if (currentConfig && currentConfig.bot) {
    botSlugSpan.textContent = currentConfig.bot.slug;
  }

  try {
    // Obter período selecionado
    const period = periodSelect.value;
    const bot = currentConfig.bot;
    
    // Calcular datas
    let queryParams = '';
    if (period === 'all') {
      queryParams = '?range=all';
    } else {
      const days = parseInt(period, 10);
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
      queryParams = `?from=${from.toISOString()}&to=${to.toISOString()}&range=last_${days}d`;
    }

    // Fazer requisição
    const response = await fetch(`/api/admin/bots/${bot.slug}/control-kpis${queryParams}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao carregar KPIs');
    }

    // Renderizar KPIs
    renderKPICards(data.kpis);
  } catch (error) {
    console.error('Erro ao carregar KPIs:', error);
    container.innerHTML = '';
    errorState.style.display = 'block';
    document.getElementById('kpiErrorMessage').textContent = error.message || 'Falha ao carregar KPIs';
  }
}

function renderKPICards(kpis) {
  const container = document.getElementById('kpiCardsContainer');

  // Formatar números com separador de milhar PT-BR
  const formatNumber = (num) => {
    return new Intl.NumberFormat('pt-BR').format(num);
  };

  // Formatar moeda PT-BR
  const formatCurrency = (cents, currency = 'BRL') => {
    const value = cents / 100;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency
    }).format(value);
  };

  const html = `
    <div class="kpi-card" role="region" aria-label="Usuários ativos">
      <div class="kpi-card-label">Ativos no bot</div>
      <div class="kpi-card-value">${formatNumber(kpis.active_users)}</div>
      <div class="kpi-card-subtitle">Usuários que não bloquearam o bot</div>
    </div>

    <div class="kpi-card" role="region" aria-label="Usuários bloqueados">
      <div class="kpi-card-label">Bloqueados</div>
      <div class="kpi-card-value">${formatNumber(kpis.blocked_users)}</div>
      <div class="kpi-card-subtitle">Usuários que bloquearam o bot</div>
    </div>

    <div class="kpi-card" role="region" aria-label="Faturamento total">
      <div class="kpi-card-label">Faturamento</div>
      <div class="kpi-card-value">${formatCurrency(kpis.revenue_total_cents, kpis.currency)}</div>
      <div class="kpi-card-subtitle">Somatório de compras confirmadas</div>
    </div>
  `;

  container.innerHTML = html;
}

// Carregar lista de usuários pagantes
async function loadUsers() {
  const container = document.getElementById('usersListContainer');
  
  // Mostrar loading
  container.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Carregando usuários...</p>
    </div>
  `;

  try {
    const response = await fetch(`/api/admin/bots/${currentBotId}/users`);
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Erro ao carregar usuários');
    }

    const users = result.data.users || [];

    if (users.length === 0) {
      container.innerHTML = `
        <div class="empty-users">
          <h3>Nenhum usuário pagante ainda</h3>
          <p>Quando alguém realizar um pagamento, aparecerá aqui.</p>
        </div>
      `;
      return;
    }

    // Renderizar tabela de usuários
    const tableHTML = `
      <table class="users-table">
        <thead>
          <tr>
            <th>Usuário</th>
            <th>Valor</th>
            <th>Origem</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(user => `
            <tr>
              <td>
                <div class="user-name">${escapeHtml(user.fullName)}</div>
              </td>
              <td>
                <div class="user-value">${user.valueFormatted}</div>
              </td>
              <td>
                <div class="user-origin">${escapeHtml(user.origin)}</div>
              </td>
              <td>
                <span class="user-status ${user.status}">
                  ${user.status === 'paid' ? 'Pago' : 'Reembolsado'}
                </span>
              </td>
              <td>
                <button class="btn-analyze" onclick="analyzeUser(${user.id})" title="Funcionalidade em desenvolvimento">
                  Analisar
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    container.innerHTML = tableHTML;

  } catch (error) {
    console.error('[ERRO][LOAD_USERS]', error);
    container.innerHTML = `
      <div class="empty-users">
        <h3>Erro ao carregar usuários</h3>
        <p>${escapeHtml(error.message)}</p>
        <button class="btn-secondary" onclick="loadUsers()" style="margin-top: 20px;">Tentar novamente</button>
      </div>
    `;
  }
}

// Função placeholder para análise de usuário (TODO: implementar)
window.analyzeUser = function analyzeUser(userId) {
  alert('Funcionalidade de análise em desenvolvimento.\nUsuário ID: ' + userId);
}

// Helper para escapar HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
