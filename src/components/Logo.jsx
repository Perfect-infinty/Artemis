import React from 'react';
import logoUrl from '../assets/artemis-logo.png';

export default function Logo({ size = 28, className = '' }) {
  return <img className={`zero-logo ${className}`} src={logoUrl} width={size} height={size} alt="Artemis" />;
}
