-- 0004_storage_media (hand-written, drizzle-kit --custom). Owner: Backend & Database.
-- Supabase Storage bucket for product/journal images: public read, writes only owner/editor admins.
-- Public URL: ${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/<storage_path>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');
create policy product_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select app_private.is_admin('{editor}')));
create policy product_images_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select app_private.is_admin('{editor}')))
  with check (bucket_id = 'product-images' and (select app_private.is_admin('{editor}')));
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select app_private.is_admin('{editor}')));
