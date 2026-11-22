export function mountChapterReveals(motion){
  if(!motion.matches || !('IntersectionObserver' in window))return;

  const elements=[...document.querySelectorAll('[data-chapter-reveal]')];
  const viewportHeight=document.documentElement.clientHeight;
  const waiting=elements.filter(element=>element.getBoundingClientRect().top>=viewportHeight);
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      const {target, boundingClientRect, rootBounds}=entry;
      observer.unobserve(target);
      // A jump into a chapter can put the text well inside the viewport.
      // Make that text readable immediately, without replaying the entrance.
      const nearEdge=rootBounds && rootBounds.bottom-boundingClientRect.top<rootBounds.height*.28;
      if(nearEdge && motion.matches)target.dataset.chapterReveal='playing';
      else target.removeAttribute('data-chapter-reveal');
    }
  }, {rootMargin:`0px 0px -${Math.round(viewportHeight*.10)}px 0px`});

  for(const element of waiting){
    element.dataset.chapterReveal='waiting';
    observer.observe(element);
  }
  motion.addEventListener('change',()=>{
    if(motion.matches)return;
    observer.disconnect();
    for(const element of waiting)element.removeAttribute('data-chapter-reveal');
  });
}
