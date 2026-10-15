import React from 'react';
import { Icon } from './Icons.jsx';

export default function ProjectLogo({ logo, size = 16 }) {
  if (!logo) return <Icon name="folder" size={size} className="row-icon" />;
  return <img className="proj-logo" src={logo} alt="" width={size} height={size} />;
}
