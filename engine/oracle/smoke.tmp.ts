import { createOracle } from "./oracle";
const o = createOracle();
const g = o.game;
console.log(g.unitlist().filter((u:any)=>u.isVisible()).map((u:any)=>u.name+"="+u.count()+"/"+u.velocity()).join(" "));
o.tick("2020-01-01T00:01:00Z");
console.log(g.unit('larva').count()+"", g.unit('meat').count()+"");
o.commands.buyUnit({unit: g.unit('drone'), num: new o.Decimal(1)});
console.log(g.unit('drone').count()+"", g.achievementPoints(), o.rootScope.listenerErrors, JSON.stringify(o.session.state.statistics));
console.log(o.session.exportSave().slice(0,80));
