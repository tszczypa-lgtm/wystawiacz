import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name) {
 const module={exports:{}};
 new Function("module","exports",ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports);
 return module.exports;
}
const {parseOvokoRead}=load("ovoko-read"),{ovokoCarYear}=load("ovoko-car-selection");
const model=patch=>parseOvokoRead("models",{list:[{id:1,brand:7,name:"E-Class (W212)",...patch}]},"7").rows[0];
const source={title:"STEROWNIK DRZWI MERCEDES A2129004202",description:"",parameters:[]};
for(const values of[{year_start:2009,year_end:2016},{year_start:"2009",year_end:"2016"},{name:"E-Class (W212) 2009–2016"}]){
 const row=model(values);assert.equal(row.years,"2009 - 2016");assert.equal(ovokoCarYear(source,row).year,"2009");assert.equal(ovokoCarYear(source,row).technical,true);
}
assert.equal(model({year_start:0,year_end:"0000"}).years," - ");
assert.equal(ovokoCarYear(source,model({})).year,"","No guessed year from a Mercedes chassis or OE number");
assert.equal(model({year_start:"2010",year_end:"2015",name:"W212 2009-2016"}).years,"2010 - 2015","Explicit dictionary fields take priority over model-name text");
assert.equal(ovokoCarYear({...source,parameters:[{name:"Rok produkcji",values:["2012"]}]},model({year_start:2009,year_end:2016})).year,"2012");
assert.equal(model({name:"E-Class 2016-2009"}).years," - ","Reversed date ranges are not accepted as technical years");
console.log("Ovoko model years: numeric/string dictionary years, explicit model-name ranges, zero/unknown values and no invented years passed.");
