import { Star, MapPin, DollarSign } from "lucide-react";

interface RestaurantInfo {
  name: string;
  cuisine: string;
  pricePerPerson: number;
  rating: number;
  address: string;
}

interface RestaurantCardProps {
  restaurant: RestaurantInfo;
  selected: boolean;
  onClick: () => void;
}

export default function RestaurantCard({
  restaurant,
  selected,
  onClick,
}: RestaurantCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
        selected
          ? "border-primary-500 bg-primary-50"
          : "border-gray-200 bg-white hover:border-primary-300"
      }`}
    >
      <h4 className="font-medium text-gray-900">{restaurant.name}</h4>
      <p className="text-xs text-gray-500 mt-0.5">{restaurant.cuisine}</p>

      <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
        <span className="flex items-center gap-0.5">
          <DollarSign className="w-3 h-3" />
          {restaurant.pricePerPerson}/人
        </span>
        <span className="flex items-center gap-0.5">
          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
          {restaurant.rating}
        </span>
      </div>

      <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
        <MapPin className="w-3 h-3" />
        <span className="truncate">{restaurant.address}</span>
      </div>
    </button>
  );
}
