// Entry-point desta publicação — monta SÓ <PreviaDemo/> (ver PreviaDemo.tsx),
// isolado de `src/main.tsx`/`src/App.tsx` do app real, que não ganham
// nenhuma linha nova por causa desta demo (mesmo padrão já usado em
// `src/previa-main.tsx` na branch de desenvolvimento, para o mesmo fim:
// um entry dedicado que nunca toca o app principal).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviaDemo } from './PreviaDemo';

const root = document.getElementById('demo-root');
if (!root) throw new Error('demo-os-cronograma/index.html precisa de <div id="demo-root"></div>.');

createRoot(root).render(
  <StrictMode>
    <PreviaDemo />
  </StrictMode>
);
