import {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Check, Crosshair, Play, RotateCcw, X} from 'lucide-react';
import {MovementLesson, demonstrationInput, demonstrationLesson} from './lesson-model';
import './tutorial.css';

const lessons = [
  {title: 'Stop before you shoot', why: 'Counter-strafe, then shoot: running adds rifle inaccuracy. Release your strafe key and briefly tap the opposite direction to brake. Crouching is not an instant stop.', task: 'In this lesson: hold D, release it, briefly tap A, then release A as you stop. Do not keep both directions held.'},
  {title: 'Aim with your movement', why: 'Crosshair placement does the work before contact: pre-aim the likely head position, then strafe into the angle. This reduces big corrections; it does not mean never using the mouse.', task: 'Keep head height, strafe until the head meets your crosshair, counter-strafe and fire. Use the mouse for off-angles, stairs or crouched opponents in a real fight.'},
  {title: 'Peek one angle at a time', why: 'Slice the pie: use cover to clear one possible enemy position at a time. Do not expose yourself to several fights just to find the first target. A wide swing can still suit a known 1v1.', task: 'Pre-aim the next angle, strafe past the wall edge, counter-strafe and fire at the exposed head. Use cover again between fights.'},
];
export function MovementTutorial({close, practice, initialLesson = 0}: {close: () => void; practice: () => void; initialLesson?: 0 | 1 | 2}) {
  const [step, setStep] = useState(initialLesson), [demo, setDemo] = useState(false), [revision, setRevision] = useState(0);
  const model = useMemo(() => demo ? demonstrationLesson(step) : new MovementLesson(step), [step, demo, revision]);
  const keys = useRef(new Set<string>()), controls = useRef(new Set<string>());
  const [, render] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.code === 'Escape') {e.preventDefault(); e.stopPropagation(); close(); return;}
      const buttonSpace = e.code === 'Space' && e.target instanceof Element && e.target.closest('button');
      if (['KeyA','KeyD','Space'].includes(e.code) && !buttonSpace) {e.preventDefault(); keys.current.add(e.code); if (e.code === 'Space' && !e.repeat && !demo) model.shoot();}
      if ((e.code === 'KeyA' || e.code === 'KeyD') && !demo) dialog.current?.focus({preventScroll: true});
      if (e.code === 'Tab') {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {e.preventDefault(); last.focus();}
        else if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first.focus();}
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => {keys.current.clear(); controls.current.clear();};
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => {window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur);};
  }, [model, demo, close]);
  useEffect(() => {
    keys.current.clear(); controls.current.clear();
    let frame = 0, last = 0, accumulator = 0, drawn = 0, demoElapsed = 0;
    const tick = (now: number) => {
      if (document.hidden) {last = now; keys.current.clear(); controls.current.clear(); frame = requestAnimationFrame(tick); return;}
      const elapsed = last ? Math.min(.05, (now - last) / 1000) : 0; last = now;
      demoElapsed += elapsed;
      // Demonstrations give readers a lead-in, then slow the clock, not the physics.
      accumulator += demo ? demoElapsed > 2 ? elapsed * .35 : 0 : elapsed;
      while (accumulator >= 1 / 128) {
        const m = model;
        const input = demo ? demonstrationInput(m) : +(keys.current.has('KeyD') || controls.current.has('KeyD')) - +(keys.current.has('KeyA') || controls.current.has('KeyA'));
        m.update(1 / 128, input);
        if (demo && m.time > .4 && m.settled && m.aligned && step > 0 && !m.complete) m.shoot();
        accumulator -= 1 / 128;
      }
      if (now - drawn > 30) {render(v => v + 1); drawn = now;}
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [step, demo, model]);
  const m = model, display = m.snapshot ?? m, lesson = lessons[step];
  const hold = (code: string) => ({onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {e.currentTarget.setPointerCapture(e.pointerId); controls.current.add(code);},
    onPointerUp: () => controls.current.delete(code), onPointerCancel: () => controls.current.delete(code), onLostPointerCapture: () => controls.current.delete(code),
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {if (e.key === ' ' || e.key === 'Enter') {e.preventDefault(); e.stopPropagation(); controls.current.add(code);}},
    onKeyUp: (e: React.KeyboardEvent<HTMLButtonElement>) => {if (e.key === ' ' || e.key === 'Enter') {e.preventDefault(); controls.current.delete(code);}},
    onBlur: () => controls.current.delete(code)});
  return <div className="lesson-backdrop"><div ref={dialog} className="movement-tutorial" role="dialog" aria-modal="true" aria-labelledby="lesson-title" tabIndex={-1}>
    <header><span>FUNDAMENTALS / {step + 1} OF 3</span><button className="icon-button" aria-label="Close tutorial" title="Close tutorial" onClick={close}><X size={20}/></button></header>
    <nav aria-label="Lessons">{lessons.map((l, i) => <button key={l.title} aria-current={step === i ? 'step' : undefined} onClick={() => {setStep(i as 0 | 1 | 2); setDemo(false);}}>{i + 1}. {l.title}</button>)}</nav>
    <h2 id="lesson-title">{lesson.title}</h2><p>{lesson.why}</p>
    <div className="lesson-scene" aria-label="Interactive movement lesson">
      <div className="lesson-head-line"/><img className="lesson-target" src="/models/target.png" alt="Practice opponent" style={{left: `calc(50% - ${display.x * 64}px)`}}/>
      <div className={`lesson-head-zone ${display.aligned ? 'aligned' : ''}`} style={{left: `calc(50% - ${display.x * 64}px)`}}/>
      {step === 2 && <div className="lesson-cover" style={{left: 0, right: 'auto', width: `clamp(0px, calc(50% - ${35 + display.x * 164}px), 100%)`}}/>}
      <Crosshair className="lesson-crosshair" size={24}/>
      <div className="lesson-speed"><span>{Math.round(Math.abs(display.velocity) / .0254)} u/s</span><meter min="0" max="225" value={Math.abs(display.velocity) / .0254}/><b className={display.settled ? 'ready' : ''}>{display.settled ? 'Low movement inaccuracy' : 'Moving: rifle inaccuracy'}</b></div>
      <span className="lesson-demo-label">{demo ? 'DEMONSTRATION / 0.35x' : 'YOUR TURN'}</span>
    </div>
    <p className="lesson-task">{lesson.task}</p>
    <div className="lesson-controls"><button {...hold('KeyA')} aria-label="Move left" disabled={demo || m.complete}><ArrowLeft size={18}/>A</button><button {...hold('KeyD')} aria-label="Move right" disabled={demo || m.complete}>D<ArrowRight size={18}/></button>{step > 0 && <button disabled={demo || m.complete} onClick={() => m.shoot()}><Crosshair size={17}/>Fire / Space</button>}</div>
    <p className={`lesson-feedback ${m.complete ? 'success' : ''}`} role="status">{m.complete && <Check size={17}/>} {m.message}{m.shotSpeed !== null && <small>Speed at shot: {m.shotSpeed.toFixed(0)} u/s. Your result stays here until you continue.</small>}</p>
    <footer><button onClick={() => {setDemo(!demo); setRevision(v => v + 1);}}><Play size={15}/>{demo ? 'Try it yourself' : 'Watch example'}</button><button aria-label="Restart lesson" title="Restart lesson" onClick={() => setRevision(v => v + 1)}><RotateCcw size={16}/></button>
      <button className="primary" disabled={!m.complete || demo} onClick={() => step < 2 ? setStep((step + 1) as 0 | 1 | 2) : practice()}>{step < 2 ? 'Next lesson' : 'Return to practice'}<ArrowRight size={16}/></button></footer>
  </div></div>;
}
