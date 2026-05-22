# VPN Admin — Android (APK)

Нативная **оболочка WebView** для уже развёрнутой веб-панели. Отдельный UI не переписывается: в приложении открывается ваш HTTPS-сайт панели (логин, пользователи, серверы — как в браузере).

## Pixel 9 и современные Android

- **Edge-to-edge**: контент под статус-баром и жестовой навигацией, отступ под **вырез камеры** (display cutout).
- Отдельные **dimens** для экранов от ~400 dp ширины (`values-sw400dp`, Pixel 9 ≈ 412 dp).
- **Портрет и альбом**: `fullUser`, пересчёт insets при повороте.
- WebView: `viewport-fit=cover`, pinch-zoom, автоподгонка текста под узкий экран.

## Требования

- [Android Studio](https://developer.android.com/studio) Ladybug / Koala или новее
- **JDK 17** для Gradle (не Java 21/25 — иначе Sync падает)
- Панель доступна по **HTTPS** с телефона (домен + валидный сертификат, либо Let's Encrypt)

## Ошибка Sync: `Unable to load class org.slf4j.LoggerFactory`

**Gradle JDK:** **ms-17** / **JDK 17** (как на вашем скрине) — правильно.

### Порядок действий

1. Закройте Android Studio.
2. В PowerShell:

```powershell
cd C:\git_clone\VPN\android-panel
.\gradlew.bat --stop
Remove-Item -Recurse -Force .\.gradle -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\app\build -ErrorAction SilentlyContinue
```

3. Откройте Studio → папка **`android-panel`** (не корень VPN).
4. **Gradle JDK** = **ms-17** → **Apply → OK**.
5. **File → Sync Project with Gradle Files** (или *Re-download dependencies…*).
6. Если снова ошибка — один раз очистите кэш Gradle:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.gradle\caches\8.6" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:USERPROFILE\.gradle\caches\modules-2" -ErrorAction SilentlyContinue
```

   Снова Sync в Studio.

7. **Build → Build APK(s)**.

Проект использует **Gradle 8.6 + AGP 8.4.2** (стабильная связка для JDK 17).

## Быстрая сборка debug APK

1. Укажите URL панели (один из способов):
   - при первом запуске приложения на телефоне;
   - или заранее в `app/src/main/res/values/strings.xml` → `panel_url` (вместо `https://ВАШ_ДОМЕН_ПАНЕЛИ`).

2. В Android Studio: **File → Open** → папка `android-panel` → **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

   Или из командной строки (в каталоге `android-panel`, после установки SDK):

   ```bash
   ./gradlew assembleDebug
   ```

   APK: `app/build/outputs/apk/debug/app-debug.apk`

## Release APK (подпись)

```bash
./gradlew assembleRelease
```

Для установки на чужие телефоны нужен подписанный keystore — настройте `signingConfigs` в `app/build.gradle.kts` (стандартная схема Android).

## Ограничения

- Это **не офлайн-приложение**: нужен интернет и работающий сервер панели.
- Сессия входа — cookie в WebView (как в Chrome).
- MySub (`/mysub`) в этом APK не нужен — только админ-панель.
- HTTP без TLS на проде Android по умолчанию блокирует (кроме localhost в `network_security_config`).

## Смена адреса панели

Очистите данные приложения в настройках Android или переустановите APK — снова откроется экран ввода URL.
