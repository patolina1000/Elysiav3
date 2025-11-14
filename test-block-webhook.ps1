# Teste de webhook my_chat_member (bloqueio)
$body = @{
    my_chat_member = @{
        from = @{
            id = 7205343917
            first_name = "Test"
        }
        chat = @{
            id = 7205343917
            type = "private"
        }
        date = 1699999999
        old_chat_member = @{
            user = @{
                id = 7205343917
            }
            status = "member"
        }
        new_chat_member = @{
            user = @{
                id = 7205343917
            }
            status = "kicked"
        }
    }
} | ConvertTo-Json -Depth 10

$headers = @{
    "Content-Type" = "application/json"
    "x-telegram-bot-api-secret-token" = "18cde8b6399bc7f263f00bcbdecfcffe4a22d571ae541957e6e8b80fb2e86d68"
}

Write-Host "Enviando webhook de bloqueio..." -ForegroundColor Yellow
$response = Invoke-WebRequest -Uri "http://localhost:3000/tg/vipshadriee_bot/webhook" -Method POST -Body $body -Headers $headers
Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
Write-Host "Response: $($response.Content)" -ForegroundColor Cyan
