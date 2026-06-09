# Firebase (мгновенные push в APK)

Проект: **`panel-c798f`**, package `com.vpnadmin.panel`.

## 1. Android (`google-services.json`)

Файл: `android-panel/app/google-services.json` (из Firebase Console).

Соберите APK **1.3.0** в Android Studio (JDK 17).

## 2. Сервер — сервисный аккаунт (обязательно для push)

Ключ «Key pair» из консоли **не подходит** для отправки. Нужен JSON сервисного аккаунта:

1. [Firebase Console](https://console.firebase.google.com/) → проект **panel-c798f**
2. ⚙ **Project settings** → **Service accounts**
3. **Generate new private key** → скачается `panel-c798f-xxxxx.json`
4. Загрузите на VPS:

```bash
scp panel-c798f-xxxxx.json vpnadm@147.90.15.77:/home/vpnadm/vpn-admin-app/backend/firebase-sa.json
```

5. В `/home/vpnadm/vpn-admin-app/backend/.env` добавьте (и **удалите** неверный `FCM_SERVER_KEY=BPqp...`):

```env
FCM_SERVICE_ACCOUNT_PATH=/home/vpnadm/vpn-admin-app/backend/firebase-sa.json
```

6. Перезапуск API:

```bash
sudo systemctl restart vpn-admin-api
```

Альтернатива: Legacy Server key (начинается с `AAAA...`) → `FCM_SERVER_KEY=AAAA...`

## 3. Проверка

1. Установите APK, войдите в панель, разрешите уведомления.
2. В браузере на ПК (войдя в панель): DevTools → Application → нет токена; на сервере в `data.json` должно появиться `panel_fcm_tokens`.
3. Тест push (из браузера, будучи залогиненным):

```http
POST /api/push/test
```

(с cookie сессии, как обычный запрос к API)

4. Создайте тестовое обращение в боте — push должен прийти сразу.

Резерв: опрос API каждые **3 минуты**, если FCM ещё не настроен.
