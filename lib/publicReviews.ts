import { query } from './db';

export type PublicReview = { id: string; rating: number; body: string; first_name: string; product: string; has_photo: boolean };

/**
 * Reviews for the home page. Only a review the customer agreed to show (public_ok), that staff
 * picked (featured), and that has real words. We show a first name and the product, nothing else.
 * A photo shows only when staff approved it and the customer agreed to it separately.
 */
export async function featuredReviews(limit = 3): Promise<PublicReview[]> {
  const rows = await query<{ id: string; rating: number; body: string; first_name: string; product: string; has_photo: boolean }>(
    `select r.id, r.rating, r.body,
            (r.photo_status = 'approved' and r.photo_public_ok and r.photo_key is not null) as has_photo,
            split_part(coalesce(c.name, ''), ' ', 1) as first_name,
            coalesce((select coalesce(i.label, p.name) from order_items i join products p on p.id = i.product_id where i.order_id = o.id order by i.id limit 1), '') as product
       from reviews r join orders o on o.id = r.order_id left join customers c on c.id = o.customer_id
      where r.public_ok and r.featured and r.rating >= 4 and length(trim(coalesce(r.body, ''))) >= 12
      order by r.created_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({ ...r, body: r.body.trim().slice(0, 400), first_name: r.first_name.trim().slice(0, 30) }));
}
