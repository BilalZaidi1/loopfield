-- Storage buckets and policies. All buckets are private. Raw GPS evidence and exports are reachable
-- only by the service role (exports are handed out through short-lived signed URLs minted server-side).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('gps-evidence', 'gps-evidence', false, 8388608, array['text/plain', 'application/octet-stream']),
  ('media-uploads', 'media-uploads', false, 10485760, array['image/jpeg']),
  ('post-media', 'post-media', false, 10485760, array['image/jpeg']),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg']),
  ('exports', 'exports', false, 104857600, array['application/zip', 'application/json'])
on conflict (id) do nothing;

-- Original uploads: owners may write and re-read their own staging objects (for retries) only.
create policy media_uploads_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'media-uploads' and (storage.foldername(name))[1] = auth.uid()::text
              and exists (select 1 from public.post_media m where m.upload_path = name and m.owner_id = auth.uid() and m.status = 'uploaded'));
create policy media_uploads_update_own on storage.objects for update to authenticated
  using (bucket_id = 'media-uploads' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy media_uploads_select_own on storage.objects for select to authenticated
  using (bucket_id = 'media-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- Processed derivatives: readable only while the viewer may see the parent post (FR43).
create policy post_media_select_authorized on storage.objects for select to authenticated
  using (bucket_id = 'post-media' and authz.can_view_media_object(name, auth.uid()));

-- Avatars: `avatars/<user_id>/<file>.jpg`; visible to anyone allowed to see that profile.
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and authz.can_view_profile(((storage.foldername(name))[1])::uuid, auth.uid()));
create policy avatars_write_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
