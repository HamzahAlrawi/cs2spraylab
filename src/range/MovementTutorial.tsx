import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Check, Crosshair, Play, RotateCcw, X} from 'lucide-react';
import {MovementLesson, demonstrationInput, demonstrationLesson} from './lesson-model';
import './tutorial.css';

const lessons = [
  {title: 'Stop before you shoot', why: 'Rifles lose accuracy while running. Counter-strafing means briefly pressing the opposite movement key to stop sooner.', task: 'Hold D, release it, then briefly tap A. Do not hold both keys or keep A pressed after stopping.'},
  {title: 'Aim with your movement', why: 'Good pre-aim puts the crosshair near the head before a fight. A small sideways move can finish horizontal alignment without a large mouse correction.', task: 'Keep head height, move until the head meets your crosshair, counter-strafe and fire. In a real duel, use the mouse for unexpected positions.'},
  {title: 'Peek one angle at a time', why: 'Cover limits how many opponents can see you. Clear its edge before shooting, then stop. Crouching changes your height; it does not instantly cancel running speed.', task: 'Move out from behind the wall, align the exposed head, counter-strafe and fire. Return to cover between fights.'},
];
export function MovementTutorial({close, practice}: {close: () => void; practice: () => void}) {
  const [step, setStep] = useState(0), [demo, setDemo] = useState(false), [revision, setRevision] = useState(0);
  const model = useRef(new MovementLesson(0)), keys = useRef(new Set<string>());
  const [, render] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {close(); return;}
      if (['KeyA','KeyD','Space'].includes(e.code)) {e.preventDefault(); keys.current.add(e.code); if (e.code === 'Space' && !e.repeat && !demo) model.current.shoot();}
      if (e.code === 'Tab') {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {e.preventDefault(); last.focus();}
        else if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first.focus();}
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => {window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); previous?.focus();};
  }, [demo]);
  useEffect(() => {
    model.current = demo ? demonstrationLesson(step) : new MovementLesson(step); keys.current.clear();
    let frame = 0, last = 0, accumulator = 0, drawn = 0, demoElapsed = 0;
    const tick = (now: number) => {
      if (document.hidden) {last = now; keys.current.clear(); frame = requestAnimationFrame(tick); return;}
      const elapsed = last ? Math.min(.05, (now - last) / 1000) : 0; last = now;
      demoElapsed += elapsed;
      // Demonstrations give readers a lead-in, then slow the clock, not the physics.
      accumulator += demo ? demoElapsed > 2 ? elapsed * .35 : 0 : elapsed;
      while (accumulator >= 1 / 128) {
        const m = model.current;
        const input = demo ? demonstrationInput(m) : +keys.current.has('KeyD') - +keys.current.has('KeyA');
        m.update(1 / 128, input);
        if (demo && m.time > .4 && m.settled && m.aligned && step > 0 && !m.complete) m.shoot();
        accumulator -= 1 / 128;
      }
      if (now - drawn > 30) {render(v => v + 1); drawn = now;}
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [step, demo, revision]);
  const m = model.current, lesson = lessons[step];
  const hold = (code: string) => ({onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {e.currentTarget.setPointerCapture(e.pointerId); keys.current.add(code);},
    onPointerUp: () => keys.current.delete(code), onPointerCancel: () => keys.current.delete(code), onLostPointerCapture: () => keys.current.delete(code)});
  return <div className="lesson-backdrop"><div ref={dialog} className="movement-tutorial" role="dialog" aria-modal="true" aria-labelledby="lesson-title" tabIndex={-1}>
    <header><span>FUNDAMENTALS / {step + 1} OF 3</span><button className="icon-button" aria-label="Close tutorial" title="Close tutorial" onClick={close}><X size={20}/></button></header>
    <nav aria-label="Lessons">{lessons.map((l, i) => <button key={l.title} aria-current={step === i ? 'step' : undefined} onClick={() => {setStep(i); setDemo(false);}}>{i + 1}. {l.title}</button>)}</nav>
    <h2 id="lesson-title">{lesson.title}</h2><p>{lesson.why}</p>
    <div className="lesson-scene" aria-label="Interactive movement lesson">
      <div className="lesson-head-line"/><img className="lesson-target" src="/models/target.png" alt="Practice opponent" style={{left: `calc(50% - ${m.x * 64}px)`}}/>
      <div className={`lesson-head-zone ${m.aligned ? 'aligned' : ''}`} style={{left: `calc(50% - ${m.x * 64}px)`}}/>
      {step === 2 && <div className="lesson-cover" style={{left: 0, right: 'auto', width: `clamp(0px, calc(50% - ${35 + m.x * 164}px), 100%)`}}/>}
      <Crosshair className="lesson-crosshair" size={24}/>
      <div className="lesson-speed"><span>{Math.round(Math.abs(m.velocity) / .0254)} u/s</span><meter min="0" max="225" value={Math.abs(m.velocity) / .0254}/><b className={m.settled ? 'ready' : ''}>{m.settled ? 'Low movement inaccuracy' : 'Moving: rifle inaccuracy'}</b></div>
      <span className="lesson-demo-label">{demo ? 'DEMONSTRATION / 0.35x' : 'YOUR TURN'}</span>
    </div>
    <p className="lesson-task">{lesson.task}</p>
    <div className="lesson-controls"><button {...hold('KeyA')} aria-label="Move left" disabled={demo}><ArrowLeft size={18}/>A</button><button {...hold('KeyD')} aria-label="Move right" disabled={demo}>D<ArrowRight size={18}/></button><button disabled={demo || step === 0} onClick={() => m.shoot()}><Crosshair size={17}/>Fire / Space</button></div>
    <p className={`lesson-feedback ${m.complete ? 'success' : ''}`} role="status">{m.complete && <Check size={17}/>} {m.message}{m.shotSpeed !== null && <small>Speed at shot: {m.shotSpeed.toFixed(0)} u/s. Your result stays here until you continue.</small>}</p>
    <footer><button onClick={() => {setDemo(!demo); setRevision(v => v + 1);}}><Play size={15}/>{demo ? 'Try it yourself' : 'Watch example'}</button><button aria-label="Restart lesson" title="Restart lesson" onClick={() => setRevision(v => v + 1)}><RotateCcw size={16}/></button>
      <button className="primary" disabled={!m.complete || demo} onClick={() => step < 2 ? setStep(step + 1) : practice()}>{step < 2 ? 'Next lesson' : 'Practice in the range'}<ArrowRight size={16}/></button></footer>
  </div></div>;
}
