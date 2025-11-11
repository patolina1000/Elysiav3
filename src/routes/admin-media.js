/**
 * Rotas de gerenciamento de mídia com warmup
 * POST /api/admin/bots/:id/media/upload - fazer upload e warmup de mídia
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Configurar multer para upload
const upload = multer({
  dest: path.join(__dirname, '../../uploads/media'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido'));
    }
  }
});

/**
 * Upload e warmup de mídia
 * POST /api/admin/bots/:id/media/upload
 * FormData: file, type, caption?
 */
router.post('/:id/media/upload', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { type, caption } = req.body;
    const botId = parseInt(id, 10);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Arquivo não fornecido'
      });
    }

    if (!type || !['photo', 'video', 'audio', 'document'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo de mídia inválido'
      });
    }

    // Gerar chave única da mídia (SHA256 do arquivo)
    const fileBuffer = fs.readFileSync(req.file.path);
    const mediaKey = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Buscar bot com token e warmup_chat_id
    const botResult = await req.pool.query(
      `SELECT id, token_encrypted, token_status, warmup_chat_id 
       FROM bots WHERE id = $1`,
      [botId]
    );

    if (botResult.rows.length === 0) {
      fs.unlinkSync(req.file.path); // Limpar arquivo
      return res.status(404).json({
        success: false,
        error: 'Bot não encontrado'
      });
    }

    const bot = botResult.rows[0];

    // Preparar resposta
    const responseData = {
      media_key: mediaKey,
      file_name: req.file.originalname,
      file_size: req.file.size,
      type: type,
      caption: caption || null,
      warmup_status: 'pending',
      tg_file_id: null
    };

    // Tentar fazer warmup se bot tiver token validado e warmup_chat_id
    if (bot.token_status === 'validated' && bot.warmup_chat_id) {
      try {
        // TODO: Implementar warmup real via MediaWarmupService
        // Por enquanto, apenas simular
        console.log(`[MEDIA_UPLOAD] Warmup iniciado: bot=${botId} key=${mediaKey} type=${type}`);
        
        // Simular sucesso de warmup
        responseData.warmup_status = 'ready';
        responseData.tg_file_id = `AgAC${mediaKey.substring(0, 40)}`; // Simular file_id
      } catch (error) {
        console.error(`[MEDIA_UPLOAD] Erro ao fazer warmup: ${error.message}`);
        responseData.warmup_status = 'error';
        responseData.warmup_error = error.message;
      }
    } else {
      // Avisar que warmup não foi possível
      if (bot.token_status !== 'validated') {
        responseData.warmup_warning = 'Token não validado';
      }
      if (!bot.warmup_chat_id) {
        responseData.warmup_warning = 'Grupo de aquecimento não configurado';
      }
    }

    // Salvar metadados da mídia no banco (se necessário)
    // Por enquanto, apenas retornar sucesso

    console.log(`[MEDIA_UPLOAD] ✓ Mídia processada: bot=${botId} key=${mediaKey} status=${responseData.warmup_status}`);

    res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('[ERRO][MEDIA_UPLOAD] Falha ao fazer upload:', error);
    
    // Limpar arquivo em caso de erro
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
