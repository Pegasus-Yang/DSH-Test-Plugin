/** 测试计划、运行事实及结果的共同类型与输入校验。 */
import { Ajv } from 'ajv';
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type Status = 'PASS'|'FAIL'|'ERROR'|'BLOCKED'|'SKIPPED'|'CANCELLED'|'INCONCLUSIVE';
export type Phase = 'setup'|'test'|'cleanup';
export type Operator = 'eq'|'neq'|'contains'|'range'|'exists'|'text'|'visible';
export interface SourceRef {id:string;kind:string;uri:string;version:string;locator:string;excerpt:string}
export interface DataRow {data_id:string;inputs:Record<string,Json>;expected:Record<string,Json>}
export interface Capture {kind:'dom'|'http'|'browser_close'; selector?:string; mode?:'text'|'number'|'count'|'visible'|'url'|'attribute'|'value';attribute?:string;url?:string;field?:string;index?:number}
export interface ActionSpec {goal:string;capability:'browser'|'api';allowed_targets:string[];inputs:Record<string,Json>;outputs:Record<string,Record<string,unknown>>;completion_requirements:string[];capture?:Record<string,Capture>;approval?:boolean}
export interface AssertionSpec {observation_ref:string;operator:Operator;expected_ref?:string;literal?:Json;expected_observation_ref?:string;rule_ref:string;unit?:string;tolerance?:number}
export interface Step {step_id:string;kind:'action'|'assertion';description:string;depends_on:string[];required:boolean;action?:ActionSpec;assertion?:AssertionSpec;run_if?:'always'|'resource_exists';resource_ref?:string}
export interface TestCase {case_id:string;name:string;preconditions:Step[];datasets:DataRow[];steps:Step[];cleanup:Step[]}
export interface TestSuite {schema_version:'1';suite_id:string;name:string;source_refs:SourceRef[];cases:TestCase[]}
export interface Binding {suite_run_id:string;case_run_id:string;phase:Phase;step_id:string;attempt_id:string}
export interface Observation {observation_id:string;binding:Binding;producer:{call_id:string;adapter:string;field:string};context_id:string;output_name:string;value:Json;evidence_refs:string[];observed_at:string}
export interface Evidence {evidence_id:string;relative_path:string;media_type:string;sha256:string;redacted:boolean}
export interface CallRecord {call_id:string;binding:Binding;name:string;args_redacted:Json;started_at:string;finished_at?:string;isError?:boolean;result?:Json;body_started:'unknown'|boolean}
export interface AssertionResult {assertion_id:string;status:Status;operator:Operator;expected:Json;actual:Json;reason:string;operand_snapshot:{actual_observation_id?:string;expected_observation_id?:string;actual_path:string;expected_path?:string};evidence_refs:string[];plan_revision:number}
export interface StepResult {step_id:string;phase:Phase;description:string;required:boolean;status:Status|'SUCCEEDED'|'RUNNING';started_at:string;finished_at?:string;duration_ms:number;reason?:string;calls:CallRecord[];observations:Observation[];assertion?:AssertionResult;cleanup_applicable?:boolean}
export interface CaseRun {case_run_id:string;case_id:string;data_id:string;name:string;data:DataRow;session_id?:string;cleanup_session_id?:string;status:Status|'PENDING'|'RUNNING'|'WAITING_APPROVAL';lifecycle:'CREATED'|'RUNNING'|'FINISHED'|'CANCELLING'|'INTERRUPTED';steps:StepResult[];issues:string[];applied_revisions:number[];effective_required_assertion_ids:string[];effective_steps:Step[];resources:Record<string,{id:string;state:'exists'|'absent'|'unknown'}>;cancelled:boolean;blocked:boolean;integrity_error:boolean;incomplete:boolean;unsettled_call_ids:string[];resource_quarantined:boolean}
export interface SuiteRun {schema_version:'1';suite_run_id:string;name:string;created_at:string;finished_at?:string;lifecycle:'RUNNING'|'FINISHED'|'CANCELLING'|'INTERRUPTED';plan:TestSuite;instances:CaseRun[];evidence:Evidence[];incomplete:boolean;resource_quarantined:boolean;manifest:Record<string,Json>}
export interface PlanRevision {revision:number;parent_revision:number;reason:string;source_refs:SourceRef[];added_steps:Step[];target_instance_ids:string[];insertion_boundary:string;post_hoc:boolean}
export const ajv = new Ajv({allErrors:true,strict:false});
const id={type:'string',pattern:'^[A-Za-z0-9_-]+$',minLength:1};
const stepSchema={type:'object',required:['step_id','kind','description','depends_on','required'],additionalProperties:false,properties:{step_id:id,kind:{enum:['action','assertion']},description:{type:'string',minLength:1},depends_on:{type:'array',items:id,uniqueItems:true},required:{type:'boolean'},run_if:{enum:['always','resource_exists']},resource_ref:id,action:{type:'object',required:['goal','capability','allowed_targets','inputs','outputs','completion_requirements'],additionalProperties:false,properties:{goal:{type:'string',minLength:1},capability:{enum:['browser','api']},allowed_targets:{type:'array',minItems:1,items:{type:'string',minLength:1}},inputs:{type:'object'},outputs:{type:'object',additionalProperties:{type:'object'}},completion_requirements:{type:'array',items:id,uniqueItems:true},capture:{type:'object',additionalProperties:{type:'object',required:['kind'],additionalProperties:false,properties:{kind:{enum:['dom','http','browser_close']},selector:{type:'string'},mode:{enum:['text','number','count','visible','url','attribute','value']},attribute:{type:'string'},url:{type:'string'},field:{type:'string'},index:{type:'integer',minimum:0}}}},approval:{type:'boolean'}}},assertion:{type:'object',required:['observation_ref','operator','rule_ref'],additionalProperties:false,properties:{observation_ref:{type:'string'},operator:{enum:['eq','neq','contains','range','exists','text','visible']},expected_ref:{type:'string'},expected_observation_ref:{type:'string'},literal:{},rule_ref:id,unit:{type:'string'},tolerance:{type:'number',minimum:0}}}}};
const sourceSchema={type:'object',required:['id','kind','uri','version','locator','excerpt'],properties:{id,kind:{type:'string'},uri:{type:'string'},version:{type:'string'},locator:{type:'string'},excerpt:{type:'string'}}};
export const planSchema={type:'object',required:['schema_version','suite_id','name','source_refs','cases'],additionalProperties:false,properties:{schema_version:{const:'1'},suite_id:id,name:{type:'string',minLength:1},source_refs:{type:'array',minItems:1,items:sourceSchema},cases:{type:'array',minItems:1,items:{type:'object',required:['case_id','name','preconditions','datasets','steps','cleanup'],additionalProperties:false,properties:{case_id:id,name:{type:'string'},preconditions:{type:'array',items:stepSchema},datasets:{type:'array',items:{type:'object',required:['data_id','inputs','expected'],additionalProperties:false,properties:{data_id:id,inputs:{type:'object'},expected:{type:'object'}}}},steps:{type:'array',minItems:1,items:stepSchema},cleanup:{type:'array',items:stepSchema}}}}}};
const validate=ajv.compile<TestSuite>(planSchema);
/** 读取自有JSON字段；不存在返回undefined，不作类型转换。 */
export function field(value:unknown,path:string):unknown {return path?path.split('.').reduce<unknown>((v,k)=>v!==null&&typeof v==='object'&&Object.hasOwn(v,k)?(v as Record<string,unknown>)[k]:undefined,value):value;}
/** 校验计划的结构、引用、数据及必需依赖。 */
export function parsePlan(input:unknown):TestSuite {
  if(!validate(input)) throw new Error(ajv.errorsText(validate.errors,{separator:'; '}));
  const plan=structuredClone(input),cases=new Set<string>(),sourceIds=new Set(plan.source_refs.map(s=>s.id));
  if(sourceIds.size!==plan.source_refs.length) throw new Error('来源ID重复');
  for(const c of plan.cases){
    if(cases.has(c.case_id))throw new Error('用例ID重复: '+c.case_id);cases.add(c.case_id);
    if(!c.datasets.length)c.datasets=[{data_id:'default',inputs:{},expected:{}}];
    if(new Set(c.datasets.map(d=>d.data_id)).size!==c.datasets.length)throw new Error('数据ID重复');
    if(!c.steps.some(s=>s.kind==='assertion'&&s.required))throw new Error('至少需要一个必需业务断言');
    const seen=new Map<string,Step>();
    for(const s of [...c.preconditions,...c.steps,...c.cleanup]){
      if(s.step_id.startsWith('__'))throw new Error('步骤ID不得使用保留前缀__');
      if(seen.has(s.step_id))throw new Error('步骤ID重复: '+s.step_id);
      for(const dep of s.depends_on){const d=seen.get(dep);if(!d||s.required&&!d.required)throw new Error('非法前序/可选依赖: '+dep);}
      if((s.kind==='action')!==Boolean(s.action)||(s.kind==='assertion')!==Boolean(s.assertion))throw new Error('步骤类型与内容不匹配');
      if(s.action){
        const a=s.action;
        for(const [name,schema] of Object.entries(a.outputs)){if(!/^[A-Za-z0-9_-]+$/.test(name))throw new Error('非法输出名');ajv.compile(schema);}
        for(const name of a.completion_requirements)if(!Object.hasOwn(a.outputs,name))throw new Error('必要输出未声明: '+name);
        for(const [name,cap] of Object.entries(a.capture??{})){if(!Object.hasOwn(a.outputs,name))throw new Error('采集输出未声明');if(cap.kind==='dom'&&cap.mode!=='url'&&!cap.selector)throw new Error('DOM采集缺少selector');if(cap.kind==='http'&&!cap.url)throw new Error('API采集缺少URL');}
        for(const value of Object.values(a.inputs)){if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.input_ref==='string')for(const row of c.datasets)if(field({data:row},value.input_ref)===undefined)throw new Error('输入未绑定: '+value.input_ref);}
      }
      if(s.assertion){
        const a=s.assertion;
        if(['expected_ref','literal','expected_observation_ref'].filter(k=>Object.hasOwn(a,k)).length!==1)throw new Error('预期来源必须恰选一种');
        if(!sourceIds.has(a.rule_ref))throw new Error('规则来源不存在');
        for(const ref of [a.observation_ref,a.expected_observation_ref].filter((v):v is string=>!!v)){
          const [producer,output]=ref.split('.'),p=seen.get(producer!);
          if(!p?.action||!Object.hasOwn(p.action.outputs,output!)||s.required&&!p.required)throw new Error('观察不存在或来自可选步骤: '+ref);
        }
        if(a.expected_ref){if(!a.expected_ref.startsWith('data.expected.'))throw new Error('预期仅允许数据预期引用');for(const row of c.datasets)if(field({data:row},a.expected_ref)===undefined)throw new Error('预期未绑定: '+a.expected_ref);}
        if(a.operator==='range'&&(!a.unit||a.tolerance===undefined))throw new Error('数值范围必须声明单位和容差');
      }
      if(s.resource_ref&&s.resource_ref!=='browser_context')throw new Error('首版只支持由adapter登记的browser_context资源');
      if(c.cleanup.includes(s)&&(!s.run_if||s.run_if==='resource_exists'&&!s.resource_ref))throw new Error('清理缺少条件/资源引用');
      seen.set(s.step_id,s);
    }
  }
  return plan;
}
/** 为每条数据创建独立实例，不做笛卡尔积。 */
export function expand(plan:TestSuite):CaseRun[]{return plan.cases.flatMap(c=>c.datasets.map(d=>({case_run_id:`${c.case_id}--${d.data_id}`,case_id:c.case_id,data_id:d.data_id,name:c.name,data:structuredClone(d),status:'PENDING' as const,lifecycle:'CREATED' as const,steps:[],issues:[],applied_revisions:[0],effective_required_assertion_ids:c.steps.filter(s=>s.kind==='assertion'&&s.required).map(s=>s.step_id),effective_steps:structuredClone(c.steps),resources:{},cancelled:false,blocked:false,integrity_error:false,incomplete:false,unsettled_call_ids:[],resource_quarantined:false})));}
/** 按冻结的有效断言集合聚合，局部可选问题不遮蔽必需结果。 */
export function aggregate(run:CaseRun):Status {
  if(run.integrity_error||run.incomplete||run.resource_quarantined||run.steps.some(s=>s.required&&(s.status==='ERROR'||s.phase==='cleanup'&&s.cleanup_applicable&&s.status!=='SUCCEEDED'&&s.status!=='PASS')))return 'ERROR';
  const assertions=run.effective_required_assertion_ids.map(id=>run.steps.find(s=>s.phase==='test'&&s.step_id===id));
  if(assertions.some(s=>s?.assertion?.status==='FAIL'))return 'FAIL';
  if(run.cancelled)return 'CANCELLED';
  if(run.blocked)return 'BLOCKED';
  if(!assertions.length||assertions.some(s=>s?.assertion?.status!=='PASS'))return 'INCONCLUSIVE';
  if(run.steps.some(s=>s.required&&s.phase!=='cleanup'&&!['SUCCEEDED','PASS'].includes(s.status)))return 'INCONCLUSIVE';
  return 'PASS';
}
export function statistics(run:SuiteRun):Record<string,number>{const stats:Record<string,number>={total:run.instances.length};for(const i of run.instances)stats[i.status]=(stats[i.status]??0)+1;return stats;}
