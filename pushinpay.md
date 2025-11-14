Criar PIX
Esse endpoint cria um código PIX para pagamento.

Pontos de atenção

Tenha sua conta CRIADA e Aprovada.
Caso não tenha conta realizar no link https://app.pushinpay.com.br/register
Para utilização do ambiente SANDBOX fazer o cadastro primeiramente no ambiente de produção (acima) e depois no suporte solicitar a liberação do ambiente SANDBOX;
Valores sempre em CENTAVOS.
Valor mínimo de 50 centavos;
Percentual máximo de 50% para SPLIT entre contas;
Checar o limite de valor máximo em sua conta;
Caso não tenha um servidor para receber as notificações da transação não preencha o campo webhook_url;
Obrigatoriedade de Aviso sobre o Papel da PUSHIN PAY

Item 4.10 do nosso Termos de Uso https://pushinpay.com.br/termos-de-uso;
É de responsabilidade do usuário da plataforma PUSHIN PAY, titular da conta, informar de maneira clara, destacada e acessível em seus canais de venda (sites, redes sociais, aplicativos, plataformas, entre outros), que:
“A PUSHIN PAY atua exclusivamente como processadora de pagamentos e não possui qualquer responsabilidade pela entrega, suporte, conteúdo, qualidade ou cumprimento das obrigações relacionadas aos produtos ou serviços oferecidos pelo vendedor.”
Esse aviso deve constar no momento da oferta e antes da finalização do pagamento, preferencialmente na página de checkout, nos termos de compra e/ou nas comunicações automáticas relacionadas à transação.
O não cumprimento pode gerar penalizações e até bloqueio da conta;
Exemplo de Resposta - Endpoint
{ "id": "9c29870c-9f69-4bb6-90d3-2dce9453bb45", "qr_code": "00020101021226770014BR.GOV.BCB.PIX2555api...", "status": "created", "value": 35, "webhook_url": "http://teste.com", "qr_code_base64": "data:image/png;base64,iVBORw0KGgoAA.....", "webhook": null, "split_rules": [], "end_to_end_id": null, "payer_name": null, "payer_national_registration": null }


📝 Descrição dos Campos

Campo

Tipo

Descrição

id

string

Identificador único da transação gerada. Salve a mesma para consultar o status da mesma.

qr_code

string

Código PIX completo no padrão EMV para ser copiado e pago manualmente.

status

string

Status atual da transação (created | paid | expired).

value

integer

Valor da cobrança em centavos de reais.

webhook_url

string

URL informada para receber notificações de pagamento.

qr_code_base64

string

Imagem do QR Code no formato base64, ideal para exibição.

webhook

string/null

Retorno interno do processamento da notificação enviada, se houver.

split_rules

array

Lista com as regras de divisão de valores (caso existam splits configurados).

end_to_end_id

string/null

Código identificador do PIX gerado pelo Banco Central (aparece após o pagamento).

payer_name

string/null

Nome do pagador, retornado após o pagamento.

payer_national_registration

string/null

CPF ou CNPJ do pagador, retornado após o pagamento.

Webhook de retorno
Ao adicionar o campo webhook_url na criação do qrcode pix, quando o status for alterados e caso falhe a tentativa nós tentaremos enviar 3x, e caso as 3x falhe, via painel administrativo será possível retomar os envios do mesmo. Também é possível adicionar um header customizado que iremos enviar para você em todos os webhooks, essa configuração está disponível em seu menu de configurações de nosso painel

Não recomendamos a pratica de scrap, por isso atente-se a usar os nossos webhooks para receber alterações de status

Erros de Limite e Validação

Valor acima do limite permitido: Quando o valor enviado para geração do QR Code PIX ultrapassa o limite máximo configurado na conta , será retornada a mensagem informando o valor máximo permitido ;
Valor do split maior que o valor total: Se o valor definido para o split for maior do que o valor total da transação, será retornado um erro indicando que o valor da transação não pode ser menor que o valor do split.
Split + taxa maior que o valor total: Quando a soma do valor do split com a taxa de transação for maior que o valor total da transação, o sistema retorna uma mensagem indicando que isso não é permitido.
Conta de split não encontrada: Caso o account_id informado em algum dos splits não corresponda a uma conta válida no banco de dados, será exibida uma mensagem de erro informando que a conta não foi encontrada.
Valor total dos splits excede o valor da transação: Se a soma dos valores dos splits (incluindo a taxa) for maior que o valor total da transação, um erro será retornado informando que a soma não pode exceder o valor da transação.
Splits do token inválidos: A mesma validação anterior se aplica ao caso em que os splits vêm de um token usado na geração da transação. Se os valores forem inconsistentes, o erro indicará que a soma dos splits vinculados ao token não pode exceder o valor da transação.
Header Parameters
Authorization
string
Required
Colocar no formato Bearer TOKEN

Accept
string
Required
application/json

Content-Type
string
Required
application/json

Body Parameters
value
number
Required
Adicione o valor em centavos. O mínimo deve ser 50 centavos

webhook_url
string
Caso tenha um servidor para receber as informações de pagamento ou estorno informe aqui sua URL

split_rules
array
Utilizado para realizar SPLIT para várias contas já cadastradas na PUSHINPAY { "value": 50, "account_id": "9C3XXXXX3A043" }

Response
200
Object
{ "id": "9e6e0...", "qr_code": "000201...", "status": "created" | "paid" | "canceled", "value": 50, "webhook_url": "https://seu-site.com", "qr_code_base64": "data:image/png;base64,iVBOR...", "webhook": {}, "split_rules": [], "end_to_end_id": {}, "payer_name": {}, "payer_national_registration": {} }
400
Object
Bad Request -- Composição do request inválido
401
Object
Unauthorized -- Chave TOKEN inválida
403
Object
Forbidden -- Apenas administradores
404
Object
Not Found -- Pedido não existe
405
Object
Method Not Allowed -- Método não permitido
406
Object
Not Acceptable -- Formato JSON inválido
410
Object
Gone -- Essa requisição não existe mais
418
Object
I'm a teapot.
422
Object
{ "message": "O campo value deve ser no mínimo 50.", "errors": { "value": [ "O campo value deve ser no mínimo 50." ] } }
429
Object
Too Many Requests -- Muitas requisições em um curto espaço de tempo
500
Object
Internal Server Error -- Favor tente mais tarde
503
Object
Service Unavailable -- Estamos temporariamente inativos, favor aguardar.
Was this section helpful?
Yes
No

Previous

Pix

Next

Consultar PIX




Base URL

Produção:

https://api.pushinpay.com.br/api

SandBox (Homolog):

https://api-sandbox.pushinpay.com.br/api

Language Box

cURL
Ruby
Ruby
Python
Python
PHP
PHP
Java
Java
Node.js
Node.js
Go
Go
.NET
.NET
POST

/pix/cashIn

cURL


curl --location 'https://api.pushinpay.com.br/api/pix/cashIn' \
--header 'Authorization: Bearer' \
--header 'Accept: application/json' \
--header 'Content-Type: application/json' \
--data '{
  "value": 51,
  "webhook_url": "https://seu-site.com",
  "split_rules": []
}'
Response

200
400
401
403
404
405
406
410
418
422
429
500
503

{
  "id": "9e6e0...",
  "qr_code": "000201...",
  "status": "created" | "paid" | "canceled",
  "value": 50,
  "webhook_url": "https://seu-site.com",
  "qr_code_base64": "data:image/png;base64,iVBOR...",
  "webhook": {},
  "split_rules": [],