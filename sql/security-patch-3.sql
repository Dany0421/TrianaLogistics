-- ============================================================
-- PROCUREMENT SYSTEM — Security Patch 3
-- Applied: 2026-04-19
-- Run in Supabase SQL Editor AFTER security-hardening.sql
-- ============================================================

-- ============================================================
-- 1. CRÍTICO: delete_user_by_email — adicionar role check
--    Antes: qualquer utilizador autenticado podia apagar users
--    Fix: só admin pode chamar esta função
-- ============================================================
CREATE OR REPLACE FUNCTION delete_user_by_email(user_email text)
RETURNS void AS $$
DECLARE
  uid uuid;
BEGIN
  IF get_my_role() != 'admin' THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  SELECT id INTO uid FROM auth.users WHERE email = user_email;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'User not found: %', user_email;
  END IF;
  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 2. MÉDIO: audit_log INSERT — bloquear inserts diretos de clientes
--    Antes: WITH CHECK (true) — qualquer utilizador podia injetar
--    entradas falsas no audit log
--    Fix: WITH CHECK (false) — triggers usam SECURITY DEFINER
--    e bypass RLS automaticamente, clientes nunca devem inserir
-- ============================================================
DROP POLICY IF EXISTS "audit_log_insert" ON audit_log;
CREATE POLICY "audit_log_insert"
  ON audit_log FOR INSERT
  WITH CHECK (false);

-- ============================================================
-- 3. BAIXO: clean_old_audit_logs — adicionar role check
--    Antes: qualquer utilizador podia limpar o audit log
--    Fix: só admin pode acionar a limpeza
-- ============================================================
CREATE OR REPLACE FUNCTION clean_old_audit_logs()
RETURNS void AS $$
BEGIN
  IF get_my_role() != 'admin' THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  DELETE FROM public.audit_log WHERE created_at < now() - interval '1 year';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
