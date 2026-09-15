# CI/CD для тестов (GitHub Actions)

Пошаговая инструкция: как самому поднять пайплайн проверок для этого репозитория и чтобы он **рисовал граф job’ов**, а не одну длинную ленту логов.

Репозиторий: [github.com/tzzelensky/VPN](https://github.com/tzzelensky/VPN)  
Платформа: **GitHub Actions** (репозиторий уже на GitHub).  
Деплой на VPS («катай») в этот пайп **не входит** — сначала только тесты и сборка.

---

## 0. Что уже есть в проекте

Стек: Node 20, TypeScript, `backend` (Express) + `frontend` (Vite/React).


| Слой                                                                      | Где                                 | Команда             | В CI               |
| ------------------------------------------------------------------------- | ----------------------------------- | ------------------- | ------------------ |
| API Vitest (OpenAPI matrix ~303 ops, users lifecycle, slow-network, auth) | `backend/test/api/`                 | `npm run test:api`  | job **API tests**  |
| Unit (tsx assert)                                                         | `backend/src/subscription*.test.ts` | `npm run test:unit` | job **Unit tests** |
| Live smoke на VPS                                                         | `backend/scripts/test-delete-*.mjs` | вручную на сервере  | **нет**            |
| `backend/src/testSubscription.ts`                                         | логика «тестовой подписки»          | —                   | не тест            |


Спека: `backend/src/openapi/adminOpenApi.json`. API-тесты используют изолированный temp `DATA_PATH` и `createApp()` без фоновых циклов — **без ударов по прод-стенду**.

Harness: `backend/src/createApp.ts`, `backend/test/helpers/*`, моки `userSync` / Telegram.

---



## 1. Как это работает

При каждом `push` и pull request GitHub поднимает чистую Ubuntu-машину, ставит Node, ставит зависимости и гоняет проверки. Если хоть один job упал — в PR красный крест.

```
        ┌─ unit-tests ─┐
install ┼─ api-tests ──┼─► build-backend ─┐
        └─ typecheck ──┘                   ├─► CI passed
                         build-frontend ───┘
```

Смотреть: вкладка **Actions** → конкретный run → сверху граф блоков.

---



## 2. Сделать тесты одной командой

В `backend/package.json`:

```json
"scripts": {
  "test": "vitest run && npm run test:unit",
  "test:unit": "tsx src/subscriptionClientDetect.test.ts && tsx src/subscriptionMask.test.ts",
  "test:api": "vitest run test/api",
  "test:api:contract": "vitest run test/api/openapi.contract.test.ts",
  "test:watch": "vitest"
}
```

Корень:

```json
"test": "npm test --prefix backend"
```

Локально:

```bash
cd backend
npm test
```

Ожидается: Vitest зелёный + два `ok` от unit-скриптов.

---



## 3. Файл пайплайна

Создай `.github/workflows/ci.yml` (GitHub подхватывает только файлы из `.github/workflows/`):

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  install-backend:
    name: Backend deps
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend

  unit-tests:
    name: Unit tests
    runs-on: ubuntu-latest
    needs: install-backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - name: Run unit scripts
        working-directory: backend
        run: |
          set -e
          echo "## Unit tests" >> "$GITHUB_STEP_SUMMARY"
          npm run test:unit
          echo "- subscriptionClientDetect ✅" >> "$GITHUB_STEP_SUMMARY"
          echo "- subscriptionMask ✅" >> "$GITHUB_STEP_SUMMARY"

  api-tests:
    name: API tests
    runs-on: ubuntu-latest
    needs: install-backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - name: Vitest API + OpenAPI contract
        working-directory: backend
        run: |
          set -e
          echo "## API tests" >> "$GITHUB_STEP_SUMMARY"
          npm run test:api
          echo "- OpenAPI contract matrix ✅" >> "$GITHUB_STEP_SUMMARY"
          echo "- users lifecycle / slow-network / auth ✅" >> "$GITHUB_STEP_SUMMARY"

  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    needs: install-backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - run: npx tsc --noEmit
        working-directory: backend

  build-backend:
    name: Build backend
    runs-on: ubuntu-latest
    needs: [unit-tests, api-tests, typecheck]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - run: npm run build
        working-directory: backend

  build-frontend:
    name: Build frontend
    runs-on: ubuntu-latest
    needs: [unit-tests, api-tests, typecheck]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm run build
        working-directory: frontend

  ci-ok:
    name: CI passed
    runs-on: ubuntu-latest
    needs: [build-backend, build-frontend]
    steps:
      - run: echo "All checks green"
```

Почему несколько job’ов: граф в UI, падение API не прячется в логе frontend, job `CI passed` удобно ставить required check.

---



## 4. Закоммитить и посмотреть пайп

```bash
git add backend/package.json package.json backend/test backend/src/createApp.ts backend/vitest.config.ts .github/workflows/ci.yml CI.md
git commit -m "Add API Vitest suite and GitHub Actions CI"
git push origin main
```

Дальше: **Actions** → workflow **CI** → граф job’ов. В PR появятся checks: `Unit tests`, `API tests`, `Build frontend`, …

---



## 5. Как сделать отображение лучше



### Бейдж в README

```markdown
[![CI](https://github.com/tzzelensky/VPN/actions/workflows/ci.yml/badge.svg)](https://github.com/tzzelensky/VPN/actions/workflows/ci.yml)
```



### Запрет мержа без зелёного пайпа

**Settings → Branches → Add branch protection rule** для `main`: **Require status checks** → job `CI passed`.

### Аннотации в PR

```bash
npx vitest run --reporter=github-actions --reporter=default
```

---



## 6. Чего в CI специально нет

- Секретов из `.env`, SSH на VPS, Xray, Telegram — API-тесты мокают sync/Telegram.
- Скриптов `backend/scripts/test-delete-*.mjs` — прод-пути.
- Автодеплоя. Выкладка на сервер — ручная / отдельный workflow / «катай».

---



## Чеклист

- [x] В `backend/package.json` есть `test` / `test:api` / `test:unit`
- [x] Локально `cd backend && npm test` зелёный
- [x] Лежит `.github/workflows/ci.yml` (скопировать из §3)
- [x] Файл запушен в GitHub
- [x] В **Actions** есть зелёный run **CI**
- [x] (по желанию) бейдж в README
- [x] (по желанию) branch protection: required check `CI passed`