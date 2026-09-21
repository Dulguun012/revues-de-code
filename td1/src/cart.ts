/**
 * TD1 — Code à revoir : la caisse du magasin.
 *
 * Ce fichier contient volontairement plusieurs problèmes (logique, typage,
 * lisibilité, conception). À vous de les identifier en commentaires de
 * revue, puis d'en corriger au moins trois.
 */

interface Item {
  name: string;
  price: number;
  qty: number;
}

const TAX_RATE = 0.2;

// Calcule le total TTC du panier
export function total(cart: Item[]): number {
  let sum = 0;
  for (const item of cart) {
	if(!Number.isFinite(item.price) || item.price < 0) {
		throw new Error("Prix invalide");
	}
	if(!Number.isFinite(item.qty) || item.qty <= 0) {
		throw new Error("Quantité invalide");
	}
    sum += item.price * item.qty;
  }
  const total = sum + sum * TAX_RATE
  return Number(total.toFixed(2));
}

// Formate un prix en euros
export function formatPrice(value: number): string {
  return value.toFixed(2) + " €";
}

// Encaisse le panier : affiche le total et prépare le paiement
export function checkout(cart: Item[]): void {
  if (cart.length === 0) {
    console.log("Panier vide");
    return;
  }
  const t = total(cart);
  console.log("Total à payer : " + formatPrice(t));
  // TODO: intégrer le paiement
}
