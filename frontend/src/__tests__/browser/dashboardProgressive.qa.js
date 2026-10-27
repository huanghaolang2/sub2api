async page => {
  const assert=(value,message)=>{if(!value)throw new Error(message)}
  const measurements=[]
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  for(const [width,height] of [[1440,1000],[390,844]]){
    await page.setViewportSize({width,height})
    if(await page.locator('html').evaluate(el=>el.classList.contains('dark')))await page.getByRole('button',{name:'切换主题',exact:true}).click()
    await page.getByRole('button',{name:'成功数据',exact:true}).click()
    await page.waitForFunction(()=>document.querySelectorAll('.dashboard-ranking-viewport li').length===105)
    const regions=page.locator('.dashboard-ranking-viewport')
    assert(await regions.count()===6,'expected six real ranking lists')
    for(let i=0;i<6;i++){
      const region=regions.nth(i)
      await region.evaluate(el=>{el.scrollTop=0})
      const measure=await region.evaluate(el=>{
        const box=el.getBoundingClientRect()
        const rows=[...el.querySelectorAll('li')]
        return {height:el.clientHeight,scrollHeight:el.scrollHeight,count:rows.length,visible:rows.filter(row=>{const r=row.getBoundingClientRect();return r.top>=box.top-0.5&&r.bottom<=box.bottom+0.5}).length}
      })
      assert(measure.height===815,`viewport ${i} height ${measure.height}`)
      assert(measure.count===(i<3?25:10),`list ${i} incorrect item limit`)
      if(width===1440)assert(i<3?measure.visible>=19&&measure.visible<=21:measure.visible===10,`unexpected visible rows: ${measure.visible}`)
      await region.focus()
      if(measure.scrollHeight>measure.height){
      await region.press('End')
      await page.waitForFunction(index=>{const el=document.querySelectorAll('.dashboard-ranking-viewport')[index];return el.scrollTop>0&&Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<=1},i)
      }
      const lastVisible=await region.evaluate(el=>{const box=el.getBoundingClientRect();const last=el.querySelector('li:last-child').getBoundingClientRect();return last.top>=box.top-1&&last.bottom<=box.bottom+1})
      assert(lastVisible,`list ${i} last item unreachable by keyboard`)
      measurements.push({width,index:i,...measure,scrollTop:await region.evaluate(el=>el.scrollTop),lastVisible})
    }
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)
    assert(!overflow,`horizontal overflow at ${width}`)
    const before=await page.locator('.dashboard-ranking-card').first().evaluate(el=>getComputedStyle(el).backgroundColor)
    await page.locator('.dashboard-models').screenshot({path:`/Users/hhl/work/project/sub2api/output/dashboard-progressive-loading/models-${width}-light.png`})
    await page.getByRole('button',{name:'切换主题',exact:true}).click()
    const after=await page.locator('.dashboard-ranking-card').first().evaluate(el=>getComputedStyle(el).backgroundColor)
    assert(before!==after,'dark theme did not change real CSS')
    await page.locator('.dashboard-models').screenshot({path:`/Users/hhl/work/project/sub2api/output/dashboard-progressive-loading/models-${width}-dark.png`})
    for(const [label,selector] of [['加载中','.dashboard-ranking-loading'],['空数据','.dashboard-ranking-state'],['请求失败','.dashboard-ranking-state.is-error']]){
      await page.getByRole('button',{name:label,exact:true}).click()
      await page.waitForFunction(selector=>document.querySelectorAll(selector).length===6,selector)
      const heights=await page.locator('.dashboard-ranking-viewport').evaluateAll(els=>els.map(el=>el.clientHeight))
      assert(heights.every(height=>height===815),`${label} changed list heights`)
      measurements.push({width,scenario:label,heights})
    }
  }
  assert(errors.length===0,`runtime errors: ${errors.join(', ')}`)
  await page.getByRole('button',{name:'成功数据',exact:true}).click()
  return {passed:true,measurements,runtimeErrors:errors}
}
