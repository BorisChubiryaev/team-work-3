# Еженедельник

Vite + React + TypeScript MVP для еженедельных отчетов команды.

## Что уже есть

- переключение ролей руководитель / сотрудник;
- создание команды, дедлайн и короткий код приглашения;
- настройка формы отчета по разделам;
- отправка, возврат на исправление и принятие отчета;
- панель руководителя: кто сдал, кто нет, статусы и сводная таблица;
- AI-помощник сотрудника и AI-суммаризация руководителя через Vercel Function `api/ai.ts`;
- заготовка Supabase-клиента для будущих Auth и базы;
- стиль бумажной тетради с клеткой и красной линейкой.

## Запуск

```bash
npm install
npm run dev
```

## Переменные окружения

Скопируй `.env.example` в `.env.local` и заполни значения.

```bash
cp .env.example .env.local
```

Не клади реальные ключи в репозиторий. Ключ OpenRouter и Google Client Secret, отправленные в чат, лучше перевыпустить перед продом.

## Supabase на следующем шаге

Минимальная схема:

- `profiles`: `id`, `email`, `name`, `role`;
- `teams`: `id`, `lead_id`, `name`, `join_code`, `deadline_day`, `deadline_time`, `template`;
- `team_members`: `team_id`, `user_id`, `role`;
- `reports`: `id`, `team_id`, `employee_id`, `week`, `status`, `sections`, `submitted_at`, `returned_comment`;
- `summaries`: `id`, `team_id`, `week`, `content`, `created_by`.

Google OAuth лучше подключать через Supabase Auth Provider, а секрет хранить только в Supabase/Vercel settings.
