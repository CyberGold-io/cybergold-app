import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imageId = `sha256:${"a".repeat(64)}`;
const digest = `sha256:${"b".repeat(64)}`;
const mock = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(process.env.RELEASE_FIXTURE));
fs.appendFileSync(process.env.RELEASE_LOG, JSON.stringify([path.basename(process.argv[1]), ...args])+'\\n');
if (path.basename(process.argv[1]) === 'gh') {
  const endpoint = args[1];
  if (endpoint.includes('/actions/runs/')) {
    console.log(JSON.stringify({event:cfg.event || 'push',path:'.github/workflows/ci.yml',status:'completed',conclusion:cfg.conclusion || 'success',head_repository:{full_name:'CyberGold-io/cybergold-app'},head_branch:cfg.branch,head_sha:cfg.commit}));
  } else if (endpoint.includes('/git/ref/')) {
    cfg.headReads = (cfg.headReads || 0) + 1;
    fs.writeFileSync(process.env.RELEASE_FIXTURE,JSON.stringify(cfg));
    console.log(cfg.staleAfter && cfg.headReads >= cfg.staleAfter ? 'c'.repeat(40) : cfg.commit);
  } else if (endpoint.includes('/packages/')) {
    console.log(JSON.stringify({name:endpoint.split('/').pop(),package_type:'container',owner:{login:'CyberGold-io'},visibility:cfg.visibility || 'private'}));
  } else process.exit(3);
} else if (args[0] === 'build') {
  const secret = args[args.indexOf('--secret')+1].split('src=')[1];
  fs.writeFileSync(process.env.RELEASE_PUBLIC_ENV, fs.readFileSync(secret));
} else if (args[0] === 'image' && args[1] === 'inspect') {
  if (args.includes('--format')) console.log(cfg.pulledId || cfg.imageId);
  else console.log(JSON.stringify([{Id:cfg.imageId,Os:'linux',Architecture:cfg.architecture || 'amd64',Config:{Labels:{'io.cybergold.app.commit':cfg.imageCommit || cfg.commit,'io.cybergold.app.dirty':'false','io.cybergold.profile.id':cfg.profile}}}]));
} else if (args[0] === 'image' && args[1] === 'save') {
  fs.writeFileSync(args[args.indexOf('--output')+1], 'inert test image');
} else if (args[0] === 'push') {
  const tag = args[1].split(':').pop();
  console.log(tag+': digest: '+(cfg.desiredDigest && tag === 'desired' ? cfg.desiredDigest : cfg.digest)+' size: 1234');
}
`;

function fixture(branch = "dev", overrides = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "app-image-release-"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  for (const name of ["gh", "docker"]) writeFileSync(path.join(bin, name), mock, { mode: 0o755 });
  const target = branch === "dev" ? "sandbox" : "mainnet";
  const profile = JSON.parse(readFileSync(path.join(root, `deploy/public-build/${target}.json`)));
  const cfg = {branch,commit:"e".repeat(40),imageId,digest,profile:profile.id,...overrides};
  const env = {...process.env,PATH:`${bin}:${process.env.PATH}`,RELEASE_FIXTURE:path.join(dir,"fixture.json"),RELEASE_LOG:path.join(dir,"commands.jsonl"),RELEASE_PUBLIC_ENV:path.join(dir,"public.env"),GITHUB_REPOSITORY:"CyberGold-io/cybergold-app",RELEASE_APP_BRANCH:branch,RELEASE_APP_COMMIT:cfg.commit,RELEASE_CI_RUN_ID:"123",GH_TOKEN:"test-token",GHCR_TOKEN:"test-token",GITHUB_ACTOR:"test",GITHUB_RUN_ID:"456",GITHUB_RUN_ATTEMPT:"1",CONFIG_IMAGE_ID:imageId,DOCKER_CONFIG:path.join(dir,"docker-config"),RUNNER_TEMP:dir,GITHUB_OUTPUT:path.join(dir,"outputs")};
  writeFileSync(env.RELEASE_FIXTURE, JSON.stringify(cfg));
  writeFileSync(env.RELEASE_LOG, "");
  return {dir,target,env,cfg,run(name,args=[],cwd=root) {return spawnSync("bash",[path.join(cwd,"scripts",name),...args],{cwd,env,encoding:"utf8"});},commands() {return readFileSync(env.RELEASE_LOG,"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));},close() {rmSync(dir,{recursive:true,force:true});}};
}

for (const branch of ["dev", "main"]) {
  test(`${branch} publishes only its mapped package and moves desired last`, () => {
    const f = fixture(branch);
    try {
      const result = f.run("publish-release-image.sh",[f.target,path.join(f.dir,"image.tar")]);
      assert.equal(result.status,0,result.stderr);
      const commands = f.commands();
      const pushes = commands.filter(c=>c[0]==="docker" && c[1]==="push");
      assert.deepEqual(pushes.map(c=>c[2]),[`ghcr.io/cybergold-io/cybergold-app-b2b-${f.target}-indexed:app-${f.cfg.commit}-456-1`,`ghcr.io/cybergold-io/cybergold-app-b2b-${f.target}-indexed:desired`]);
      assert.equal(commands.at(-2)[2],pushes[1][2]);
      assert.equal(commands.at(-1)[1],"logout");
      assert.ok(commands.some(c=>c[1]==="pull" && c[2].endsWith(`@${digest}`)));
      assert.ok(!commands.some(c=>c[1]==="build" || c[1]==="run" || c.join(" ").includes("cybergold-ops")));
    } finally { f.close(); }
  });

  test(`${branch} builds from public settings with the existing host identity`, () => {
    const f = fixture(branch);
    try {
      const checkout = path.join(f.dir,"checkout");
      mkdirSync(checkout);
      for (const name of ["scripts","deploy/public-build","package-lock.json","app/contracts/backend/openapi.json"]) cpSync(path.join(root,name),path.join(checkout,name),{recursive:true});
      for (const args of [["init","-q"],["add","."],["-c","user.name=Release Test","-c","user.email=release@example.invalid","commit","-qm","fixture"]]) {
        const result=spawnSync("git",args,{cwd:checkout,encoding:"utf8"});
        assert.equal(result.status,0,result.stderr);
      }
      f.env.RELEASE_APP_COMMIT=spawnSync("git",["rev-parse","HEAD"],{cwd:checkout,encoding:"utf8"}).stdout.trim();
      f.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="public-test-project";
      const result=f.run("build-release-image.sh",[f.target],checkout);
      assert.equal(result.status,0,result.stderr);
      const build=f.commands().find(c=>c[1]==="build");
      assert.ok(build.includes("linux/amd64"));
      assert.ok(build.includes(`io.cybergold.app.commit=${f.env.RELEASE_APP_COMMIT}`));
      assert.ok(build.includes(`io.cybergold.profile.id=${f.cfg.profile}`));
      assert.ok(build.includes("io.cybergold.app.runtime=split-v1"));
      assert.ok(build.includes(branch==="dev" ? "development" : "runner"));
      const publicEnv=readFileSync(f.env.RELEASE_PUBLIC_ENV,"utf8");
      assert.match(publicEnv,new RegExp(`NEXT_PUBLIC_CHAIN_ID="${branch==="dev" ? 31338 : 1}"`));
      assert.match(publicEnv,/NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="public-test-project"/);
      assert.ok(publicEnv.split("\n").filter(Boolean).every(line=>line.startsWith("NEXT_PUBLIC_")));
    } finally { f.close(); }
  });
}

for (const [name,overrides,message,noLogin] of [
  ["failed CI",{conclusion:"failure"},"did not succeed",true],
  ["PR CI",{event:"pull_request"},"must be a push",true],
  ["stale source",{staleAfter:1},"no longer the current",true],
  ["source advances before desired",{staleAfter:2},"no longer the current",false],
  ["wrong image commit",{imageCommit:"f".repeat(40)},"wrong source commit",true],
  ["wrong image platform",{architecture:"arm64"},"must target amd64",true],
  ["public package",{visibility:"public"},"retain private visibility",true],
  ["wrong registry digest",{pulledId:`sha256:${"c".repeat(64)}`},"differs from the admitted",false],
]) {
  test(`${name} cannot update desired`,()=>{
    const f=fixture("dev",overrides);
    try {
      const result=f.run("publish-release-image.sh",[f.target,path.join(f.dir,"image.tar")]);
      assert.notEqual(result.status,0);
      assert.ok(result.stderr.includes(message),result.stderr);
      assert.ok(!f.commands().some(c=>c[1]==="push" && c[2].endsWith(":desired")));
      if(noLogin) assert.ok(!f.commands().some(c=>c[1]==="login"));
    } finally {f.close();}
  });
}
