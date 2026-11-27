import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {VerificationDetail} from './src/admin-prototype/main.jsx';
import {adminWorkspaceNav} from './src/app/admin/AdminWorkspaceShell.jsx';
import {PrototypeSideNav} from './src/shared/ProfileShell.jsx';
import {DataProvider} from './src/lib/data/DataProvider.jsx';
import './admin-ai-review-preview.css';
const profile={id:'ai-review-demo',name:'Komkar Apparel',initials:'KA',entityType:'Factory',location:'Gurgaon, India',submitted:'8 days ago',status:'Ready for review',tone:'info',completion:80,evidence:'Registration and 2 factory photos',risk:'Not set',summary:"Garment manufacturer and exporter based in Gurugram, India, producing woven garments, denim, embroidery and small-batch apparel.",details:[['Submitted company name','Komkar Apparel'],['Location','Gurgaon, India'],['Year founded','2025'],['Website','Not provided'],['Profile status','Not verified'],['Decision','Not yet']],capabilityGroups:[{kind:'manufacturing_model',items:['CMT / cut, make & trim','Full package production (FPP)','OEM / made to specification']},{kind:'product_category',items:['Tops','Womenswear','Menswear','Outerwear']},{kind:'region',items:['Europe','India','United States']}],checks:[]};
const submission={profile:{legal_name:profile.name,year_founded:2025,location:profile.location},members:[{name:'Yogendra Gulati',email:'ginni.gulati@komkar.in',role:'owner'}]};
const documents=[{id:'example-registration',kind:'business_registration',file_name:'AA0603260632875_RC29042026.pdf',mime_type:'application/pdf'},{id:'example-photo-1',kind:'product_image',file_name:'Factory photo 1',mime_type:'image/jpeg'},{id:'example-photo-2',kind:'product_image',file_name:'Factory photo 2',mime_type:'image/jpeg'}];
const findings=[
  {id:'name',target:'ai-registration',topic:'Clarify the registered legal name',summary:'Company name needs clarification',observation:'The submitted company name omits the legal suffix shown in the registration document. This may be a trading name; it needs confirmation.',evidence:[['Submitted company name','Komkar Apparel'],['Name shown on the registration document','KOMKAR APPAREL (OPC) PRIVATE LIMITED']],source:'Business registration · AA0603260632875_RC29042026.pdf',question:'Please confirm your full registered legal name, including the OPC and Private Limited suffix, and whether Komkar Apparel is your trading name.'},
  {id:'dates',target:'ai-company',topic:'Confirm operating and incorporation dates',summary:'Operating and registration dates need clarification',observation:'The profile lists 2025 as the founding year, while the registration file is dated 2026. An operating start date and a document date can differ; this is not a confirmed inconsistency.',evidence:[['Year founded in the profile','2025'],['Registration document date','2026'],['Incorporation date','Needs confirmation from the document']],source:'Submitted company information and registration document',question:'Please confirm the date of incorporation and the year the business began operating. If these differ, please explain the difference.'},
  {id:'photos',target:'ai-photos',topic:'Factory photos await verification',summary:'2 factory photos are not checked yet',observation:"Neither photo has been reviewed as showing the company’s own facility. This is an outstanding reviewer check, not evidence that the photos are false.",evidence:[['Factory photo 1','Not checked yet'],['Factory photo 2','Not checked yet'],['Address check','Address not found on the map']],source:'Factory photo review status and address check',question:'Please provide current photos or a dated walkthrough showing your facility, with the company name and street address visible.'}
];

profile.summary="Komkar Apparel is a leading garment manufacturer and exporter based in Gurugram, India. We specialize in women's wear, men's wear and kids’ wear. Our expertise includes woven garments, denim, embroidery, Schiffli, sequins and garment wash programs. Our capabilities enable us to develop and deliver a wide range of fashion products while maintaining the required standards of quality, workmanship and timely delivery.";
profile.details=[['Legal name','Komkar Apparel'],['Website','—'],['Location','Gurgaon, India'],['Profile status','Not verified'],['Decided','Not yet']];
profile.capabilityGroups=[
{kind:'manufacturing_model',items:['CMT / cut, make & trim','Full package production (FPP)','ODM / design + manufacture','OEM / made to specification','Private label / white label']},
{kind:'production_type',items:['Bags / soft goods','Denim','Intimates / delicate garments','Wovens']},
{kind:'product_category',items:['Bottoms','Childrenswear / baby','Dresses & jumpsuits','Menswear','Outerwear','Sleepwear / loungewear','Tops','Uniforms / workwear','Womenswear']},
{kind:'make',items:['Button-down shirts','Canvas totes','Denim jackets','Lightweight jackets','Linen co-ords','Pleated skirts','Poplin blouses','Rib tops','Woven dresses']},
{kind:'market_level',items:['Mid range ($50–$100)']},
{kind:'specialty',items:['Embroidery / print','Fit sample + PP sample','Fit sample support','In-house pattern room','Low-MOQ sampling','Low-MOQ woven tops','QC photo updates','Small-batch export','Small-batch production','Trim sourcing','Wash development']},
{kind:'design_service',items:['CMT only','Full package (FPP)','Grading','Pattern making','Sample development','Tech pack support']},
{kind:'region',items:['Europe','India','Korea','United States']}];
profile.verification={facts:[{label:'Terms signed',value:'Not signed',ok:false},{label:'Registration uploaded',value:'AA0603260632875_RC29042026.pdf',ok:true},{label:'Company details',value:'Legal name, location, team size, year founded and introduction only',ok:false},{label:'Company age',value:'Not on the licence'},{label:'Submitted by',value:'Yogendra Gulati · ginni.gulati@komkar.in'}],groups:[
{key:'business_registration',label:'Business registration',verdict:'Address: not found on the map',fields:[{key:'number',label:'Registration number',value:'U14101HR2025OPC138380',copy:true},{key:'legalName',label:'Legal name',value:'KOMKAR APPAREL (OPC) PRIVATE LIMITED',wide:true},{key:'documentDate',label:'Document date',value:'2026'},{key:'address',label:'Address',value:'Gurgaon, India',wide:true}],evidencePane:false,checks:[{key:'licence',label:'Licence',weight:30,score:95,verdict:'Original · company registration number is 138380'},{key:'registry',label:'Registry',weight:30,score:90,verdict:'Found on Zaubacorp'},{key:'address',label:'Address',weight:15,score:0,verdict:'Not found on the map'}]},
{key:'company_information',label:'Company information',verdict:'0 of 2 their own, 2 not checked yet',evidencePane:false,fields:[{key:'companyName',label:'Company name',value:'Komkar Apparel'},{key:'year',label:'Year founded',value:'2025'},{key:'location',label:'Location',value:'Gurgaon, India'}],checks:[{key:'scope',label:'Factory or trader',weight:10,score:100,verdict:'Factory · self declared factory'},{key:'photos',label:'Photos',weight:15,score:50,verdict:'0 of 2 their own, 2 not checked yet'}]},
{key:'certification',label:'Certification evidence',verdict:'No certificate uploaded',fields:[],checks:[],evidencePane:false}]};
const adapter={actions:{termsBlock:async()=>"Approve needs: the company to sign the terms. Ask them with Request more information; they sign just before sending their profile back."}};
const groupFor=f=>f.id==='name'?'business_registration':'company_information';
// Same outlined information glyph used by the verification score’s InfoTip.
function ReviewInfoIcon(){return <svg className="ai-review-info-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M8 7.2v3.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="8" cy="4.9" r="0.95" fill="currentColor"/></svg>;}
const conciseSuggestions={
 name:'“Komkar Apparel” differs from “KOMKAR APPAREL (OPC) PRIVATE LIMITED” on the registration document. Confirm the full legal name and whether the shorter name is a trading name.',
 dates:'The profile lists 2025 as the founding year and the registration file is dated 2026. Confirm when the company was incorporated and began operating; a document date alone does not establish a discrepancy.',
 photos:'Both factory photos are unchecked. Review them to confirm they show this company’s facility; unchecked photos are not a confirmed authenticity issue.'
};
function AISuggestionNotice({items}) {
 return <div className="ai-notification-section"><div className="factory-onboarding-validation-message ai-suggestion-notification" data-shown="true" role="status"><ReviewInfoIcon/><div className="ai-notification-copy"><strong>AI {items.length===1?'suggestion':'suggestions'}</strong>{items.map(item=><p key={item.id}>{conciseSuggestions[item.id]}</p>)}</div></div></div>;
}
function App(){
 const [collapsed,setCollapsed]=useState(false),[showAI,setShowAI]=useState(true),[notice,setNotice]=useState('');
 const aiReview=showAI?{count:key=>findings.filter(f=>groupFor(f)===key).length,render:key=><AISuggestionNotice items={findings.filter(f=>groupFor(f)===key)}/>} : null;
 const summary=showAI?()=>[
 {label:'Terms signed',value:'Not signed',ok:false},
 {label:'Business registration',value:<><span className="ai-review-document-name">AA0603260632875_RC29042026.pdf</span><span>Legal name and company dates need clarification.</span></>,ok:false},
 {label:'Facility checks',value:'Address could not be located; two factory photos await verification.',ok:false},
 {label:'Submitted by',value:'Yogendra Gulati · ginni.gulati@komkar.in'}
 ]:null;
 return <DataProvider adapter={adapter}><div className={`app-shell admin-app ${collapsed?'nav-collapsed':''}`}><PrototypeSideNav account={{initials:'TS',name:'TSC Operations',type:'Admin workspace'}} active="Verification" collapsed={collapsed} navItems={adminWorkspaceNav} ariaLabel="Admin workspace" onToggle={()=>setCollapsed(x=>!x)} onNav={()=>setNotice('Local verification preview')}/><VerificationDetail profile={profile} submission={submission} documents={documents} aiSummary={summary} aiReview={aiReview} onBack={()=>setNotice('Local verification preview')} onDecision={()=>setNotice('Example only; no changes sent.')} onSuggestRequest={async()=>({message:findings.map(f=>f.question).join('\n\n')})}/>
 <div className="ai-preview-switch"><span>Local mockup</span><button type="button" className="text-link" onClick={()=>setShowAI(x=>!x)}>{showAI?'Hide AI additions':'Show AI additions'}</button></div>{notice&&<div className="app-toast" role="status" onClick={()=>setNotice('')}>{notice}</div>}</div></DataProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
