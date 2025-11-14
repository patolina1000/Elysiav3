Mensagem “mídia + texto + botões” em ~0,5s (com 1–3 mídias e limite 5 msg/s)

Objetivo: entregar sempre uma mensagem com mídia (foto/vídeo), texto (na caption) e botões (inline) no menor número de requisições possível, mirando ~0,5s do update até o recebimento do usuário.

1) Princípios de latência mínima

Responder o Webhook com o método do Bot API
Em webhook, você pode responder diretamente com o método (sendPhoto/sendVideo) e os parâmetros no corpo da resposta, economizando 1 RTT. O Telegram documenta explicitamente esse fluxo (“Reply directly and give method as JSON payload”). 
Telegram
+1

“Uma chamada, tudo incluso”
sendPhoto/sendVideo aceitam caption (texto) e reply_markup (inline keyboard). Logo, mídia + texto + botões podem ir na mesma chamada (na resposta ao webhook). 
Telegram

Reuso de mídia com file_id (recomendado e persistente)
Sempre que possível, envie file_id em vez de URL/upload para cortar processamento e upload. O manual oficial diz “Pass a file_id … (recommended)” e a FAQ confirma a persistência de file_id. Faça warm-up (enviar mídia para um canal privado uma vez, capturar e guardar o file_id). 
Telegram
+1

2) Limites: oficial vs. seu SLO (aplique 5 msg/s)

Limites oficiais (referência):
por chat ≈1 msg/s; em grupo ≤20 msg/min; broadcast gratuito ≈30 msg/s (há paid broadcasts para volumes maiores). 
Telegram

Seu limite operacional: 5 msg/s.
Aplique token bucket/fila com prioridade para /start e 429-backoff exponencial curto. Isso fica mais restritivo que o oficial e ajuda a manter a cauda p95 baixa.

3) Layouts para 1–3 mídias com botões

Fato importante: álbuns (sendMediaGroup) não aceitam reply_markup → inline keyboard não fica no álbum. 
Stack Overflow
+1

A) 1 mídia (recomendado para ~0,5s)

Passos (1 requisição): responder o webhook com sendPhoto (ou sendVideo) contendo:
chat_id, photo|video = file_id, caption (texto), reply_markup (inline keyboard).
Resultado: uma mensagem com tudo junto, latência mínima. 
Telegram
+1

B) 2–3 mídias (mantendo botões SEM abrir mão do SLO)

Escolha um dos padrões:

Padrão B1 (preferido p/ SLO):

Envie a peça principal com botões (como no A) — bate ~0,5s.

Em seguida, mande as 1–2 mídias extras (cada uma com file_id) em mensagens subsequentes dentro do seu limite 5 msg/s.
Vantagem: o CTA chega instantâneo com os botões; extras chegam logo depois. 
Telegram

Padrão B2 (1 mensagem só):
Pré-compose as 2–3 mídias em um único arquivo (colagem ou vídeo curto), e envie apenas esse arquivo com reply_markup.
Vantagem: 1 mensagem com botões; trade-off: você prepara a mídia previamente.

Evite sendMediaGroup quando precisar obrigatoriamente de botões no mesmo conteúdo; se ainda assim usar álbum, envie a mensagem com botões separada (perde a “tudo em um”). 
Stack Overflow
+1

4) Pipeline recomendado (ponta-a-ponta ~0,5s)

Webhook recebe o update.

Lookup O(1) do file_id em cache (Redis/DB) → nada de upload.

Responder o webhook com sendPhoto/sendVideo + caption + reply_markup.

(Se 2–3 mídias) enfileire as extras com file_id no seu rate de 5 msg/s.

Opcional de latência/infra: Local Bot API Server para reduzir hops e aumentar max_webhook_connections (casos extremos). 
Telegram

5) Formato de payload (exemplo conceitual)

Resposta do webhook (ex.) — tudo em uma chamada: