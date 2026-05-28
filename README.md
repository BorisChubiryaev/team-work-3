# Еженедельник

Vite + React + TypeScript MVP для еженедельных отчетов команды.

## Что уже есть

- Supabase Auth: email/password и Google OAuth;
- ролевой доступ руководитель / сотрудник через `team_members.role`;
- onboarding после регистрации: создать команду или вступить по коду;
- настоящие команды, участники, отчеты и AI-сводки в Supabase;
- RLS-политики для команд, отчетов и сводок;
- настройка формы отчета по разделам;
- отправка, возврат на исправление и принятие отчета;
- панель руководителя: кто сдал, кто нет, статусы и сводная таблица;
- AI-помощник сотрудника и AI-суммаризация руководителя через Vercel Function `api/ai.ts`;
- демо-режим без Supabase env для локального просмотра интерфейса;
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

## Настройка Supabase

1. Создай проект в Supabase.
2. Открой SQL Editor и выполни `supabase/migrations/001_initial_schema.sql`.
3. В Authentication → Providers включи Email.
4. В Authentication → Providers → Email включи `Confirm email`, чтобы регистрация требовала перехода по ссылке из письма.
5. Для Google включи Google provider и добавь свежие `Client ID` / `Client Secret`.
6. В Authentication → URL Configuration добавь:
   - локально: `http://localhost:5173`;
   - на Vercel: URL продакшн-домена.
7. Скопируй `Project URL` и `anon public key` в `.env.local`.

## Vercel

В Vercel добавь environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`, по умолчанию `openrouter/free`
- `OPENROUTER_SITE_URL`, URL приложения

Google Client Secret хранится в Supabase Auth provider settings, не в клиентском коде.

## Схема данных

Миграция создает:

- `profiles`: профиль пользователя из Supabase Auth;
- `teams`: команда руководителя, дедлайн и шаблон отчета;
- `team_members`: связь пользователя с командой и ролью;
- `reports`: еженедельные отчеты сотрудников;
- `summaries`: сохраненные AI-сводки руководителя.
