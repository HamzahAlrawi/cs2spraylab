import {ArrowUp, Flag, Layers, MapPin} from 'lucide-react';
import type {RouteNavigation} from './navigation';

export function PrefireNavigation({navigation}: {navigation: RouteNavigation}) {
  const recovery = navigation.guidance === 'wrong-level' ? 'Waypoint is on another level'
    : navigation.guidance === 'off-route' ? 'Rejoin the current route segment' : undefined;
  const distance = navigation.distance < 1 ? navigation.distance.toFixed(1) : Math.round(navigation.distance);
  return <div className="prefire-navigation" aria-label="Route directions">
    {navigation.complete ? <Flag size={22} aria-hidden="true"/> : navigation.guidance === 'wrong-level' ? <Layers size={24} aria-hidden="true"/>
      : navigation.guidance === 'off-route' ? <MapPin size={24} aria-hidden="true"/> : <ArrowUp size={24} aria-hidden="true"
      style={{transform: `rotate(${navigation.bearing}rad)`}}/>}
    <div><strong>{navigation.complete ? 'Route end' : `Waypoint ${navigation.waypoint} / ${navigation.total}`}</strong>
      <span>{navigation.complete ? 'Clear remaining angles' : recovery ?? `${distance} m to next waypoint`}</span>
      <small>{navigation.destination}</small></div>
  </div>;
}
