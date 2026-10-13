/** The address of a catalogue photo. Kept apart from the database code so pages and components can both use it. */
export const imageUrl = (id: string, size: 'thumb' | 'full' = 'thumb') => `/api/product-images/${id}${size === 'full' ? '?size=full' : ''}`;
