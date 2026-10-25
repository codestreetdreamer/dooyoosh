-- 0007 (Backend & Database), LOCAL ONLY until QA green. QA P3: anon could LIST product-images objects.
-- Public bucket downloads (/storage/v1/object/public/product-images/<path>) do not go through RLS, so the anon/authenticated
-- SELECT policy is not needed for the storefront. Listing (storage.objects select / Storage API list/search) is now
-- limited to owner/editor admins (media library in the admin UI). Upload/update/delete policies are unchanged.
drop policy if exists product_images_read on storage.objects;

create policy product_images_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and (select app_private.is_admin('{editor}')));
