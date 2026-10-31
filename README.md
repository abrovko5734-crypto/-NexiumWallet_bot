# Nexium Wallet
1. Токен бота — только в переменных Vercel (BOT_TOKEN), в код не вставлять.
2. Vercel → Storage → Upstash Redis (Marketplace) → подключить к проекту (появятся UPSTASH_* переменные).
3. Env: BOT_TOKEN, ADMIN_ID=7128871752, APP_URL=https://проект.vercel.app, WEBHOOK_SECRET=любая строка.
4. Deploy, затем открой один раз: https://проект.vercel.app/api/setup?key=WEBHOOK_SECRET
5. BotFather: /setinline (плейсхолдер "1 TON"), для Web App ничего больше не нужно.
