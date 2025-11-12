let currentBotId = null;
let currentConfig = null;
let currentMediaMode = 'group'; // 'group' ou 'single'
let currentPlansLayout = 'adjacent'; // 'adjacent' ou 'list'

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
    html += `
      <div class="item-card">
        <div class="item-card-content">
          <div class="item-card-title">${downsell.slug}</div>
          <div class="item-card-meta">
            Delay: ${downsell.delay_seconds}s | Status: ${status}
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
    html += `
      <div class="item-card">
        <div class="item-card-content">
          <div class="item-card-title">${shot.slug}</div>
          <div class="item-card-meta">
            Status: ${status} ${shot.filter_criteria ? `| Filtro: ${shot.filter_criteria}` : ''}
          </div>
        </div>
        <div class="item-card-actions">
          <button class="btn-secondary btn-small" onclick="editShot(${shot.id})">Editar</button>
          <button class="btn-danger btn-small" onclick="deleteShot(${shot.id})">Deletar</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function switchTab(tabName) {
  // Remover classe active de todos os botões e panes
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

  // Adicionar classe active ao botão e pane selecionados
  event.target.classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');
}

function showTabsContainer() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('tabsContainer').style.display = 'block';
}

function showErrorState(message) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('errorState').style.display = 'block';
  document.getElementById('errorMessage').textContent = message;
}

function updateMediaModeDisplay() {
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

function updatePlansLayout() {
  const layoutSelect = document.getElementById('plansLayout');
  if (!layoutSelect) {
    currentPlansLayout = 'adjacent';
    return;
  }

  const value = layoutSelect.value;
  currentPlansLayout = value === 'list' ? 'list' : 'adjacent';
}

async function saveStartConfiguration() {
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

async function previewStartMessage() {
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

function openAddDownsellModal() {
  document.getElementById('downsellForm').reset();
  document.getElementById('downsellId').value = '';
  document.getElementById('downsellModalTitle').textContent = 'Adicionar Downsell';
  document.getElementById('downsellModal').classList.add('active');
}

function closeDownsellModal() {
  document.getElementById('downsellModal').classList.remove('active');
}

async function saveDownsell(event) {
  event.preventDefault();

  const downsellId = document.getElementById('downsellId').value;
  const slug = document.getElementById('downsellSlug').value.trim();
  const delay_seconds = parseInt(document.getElementById('downsellDelay').value, 10);
  const content = document.getElementById('downsellContent').value.trim();
  const active = document.getElementById('downsellActive').checked;

  if (!slug || !content) {
    showAlert('Slug e conteúdo são obrigatórios', 'error');
    return;
  }

  try {
    const downsells = [{ id: downsellId || undefined, slug, content, delay_seconds, active }];

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

function editDownsell(downsellId) {
  const downsell = currentConfig.downsells.find(d => d.id === downsellId);
  if (!downsell) return;

  document.getElementById('downsellId').value = downsell.id;
  document.getElementById('downsellSlug').value = downsell.slug;
  document.getElementById('downsellDelay').value = downsell.delay_seconds;
  document.getElementById('downsellContent').value = downsell.content;
  document.getElementById('downsellActive').checked = downsell.active;
  document.getElementById('downsellModalTitle').textContent = 'Editar Downsell';
  document.getElementById('downsellModal').classList.add('active');
}

async function deleteDownsell(downsellId) {
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
}

function openAddShotModal() {
  document.getElementById('shotForm').reset();
  document.getElementById('shotId').value = '';
  document.getElementById('shotModalTitle').textContent = 'Adicionar Shot';
  document.getElementById('shotModal').classList.add('active');
}

function closeShotModal() {
  document.getElementById('shotModal').classList.remove('active');
}

async function saveShot(event) {
  event.preventDefault();

  const shotId = document.getElementById('shotId').value;
  const slug = document.getElementById('shotSlug').value.trim();
  const content = document.getElementById('shotContent').value.trim();
  const filter_criteria = document.getElementById('shotFilter').value.trim();
  const active = document.getElementById('shotActive').checked;

  if (!slug || !content) {
    showAlert('Slug e conteúdo são obrigatórios', 'error');
    return;
  }

  try {
    const shots = [{ id: shotId || undefined, slug, content, filter_criteria: filter_criteria || null, active }];

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

    showAlert('Shot salvo com sucesso!', 'success');
    closeShotModal();
    loadBotConfig();
  } catch (error) {
    console.error('Erro ao salvar:', error);
    showAlert('Erro ao salvar: ' + error.message, 'error');
  }
}

function editShot(shotId) {
  const shot = currentConfig.shots.find(s => s.id === shotId);
  if (!shot) return;

  document.getElementById('shotId').value = shot.id;
  document.getElementById('shotSlug').value = shot.slug;
  document.getElementById('shotContent').value = shot.content;
  document.getElementById('shotFilter').value = shot.filter_criteria || '';
  document.getElementById('shotActive').checked = shot.active;
  document.getElementById('shotModalTitle').textContent = 'Editar Shot';
  document.getElementById('shotModal').classList.add('active');
}

async function deleteShot(shotId) {
  if (!confirm('Tem certeza que deseja deletar este shot?')) return;

  try {
    const response = await fetch(`/api/admin/bots/${currentBotId}/config/shots`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shots: [] })
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

function addPlan() {
  const plans = getCurrentPlans();
  if (plans.length >= 10) {
    showAlert('Máximo 10 planos permitidos', 'error');
    return;
  }
  
  openPlanModal();
}

function editPlan(index) {
  const plan = currentPlans[index];
  if (!plan) return;
  
  document.getElementById('planIndex').value = index;
  document.getElementById('planName').value = plan.name;
  document.getElementById('planTime').value = plan.time;
  document.getElementById('planValue').value = formatCurrency(plan.value);
  document.getElementById('planModalTitle').textContent = 'Editar Plano';
  document.getElementById('planModal').classList.add('active');
}

function removePlan(index) {
  if (!confirm('Tem certeza que deseja remover este plano?')) return;
  
  currentPlans.splice(index, 1);
  renderPlans(currentPlans);
}

function getCurrentPlans() {
  return currentPlans;
}

function openPlanModal() {
  document.getElementById('planForm').reset();
  document.getElementById('planIndex').value = '';
  document.getElementById('planModalTitle').textContent = 'Adicionar Plano';
  document.getElementById('planModal').classList.add('active');
}

function closePlanModal() {
  document.getElementById('planModal').classList.remove('active');
}

async function savePlan(event) {
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
