/* PScript lexer and grammar (§4.1, §4.3).
 * Actions build nodes through the `yy` helpers installed by `src/parser/parse.ts`;
 * locations come from `@n` / `@$` (Jison yylloc) and are converted there.
 */

%lex

DIGITS          [0-9]+
EXPONENT        [eE][+-]?{DIGITS}
NUMBER          (({DIGITS}"."{DIGITS}?)|("."{DIGITS})|{DIGITS}){EXPONENT}?
IDENT           [A-Za-z_$][A-Za-z0-9_$]*
TEMPLATE_TEXT   (?:[^`\\$]|\\[\s\S]|\$(?!\{))*

%%

[ \t\v\f\u00A0\uFEFF]+                         /* skip whitespace */
\r\n|[\n\r]                                     return 'NEWLINE'
[\u2028\u2029]                                  return yy.lineSeparator(this)
"//"[^\n\r\u2028\u2029]*                          /* skip line comment */
"/*"[\s\S]*?"*/"                                return yy.blockComment(yytext)
"/*"                                            yy.lexError("Unterminated comment", yylloc)

0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+         return yy.numberToken(yytext, yylloc, this._input)
{NUMBER}                                        return yy.numberToken(yytext, yylloc, this._input)

\"([^"\\\r\n\u2028\u2029]|\\(\r\n|[\s\S]))*\"     return 'STRING'
\'([^'\\\r\n\u2028\u2029]|\\(\r\n|[\s\S]))*\'     return 'STRING'
["']                                            yy.lexError("Unterminated string", yylloc)

{IDENT}                                         return yy.identToken(yytext)

/* Template literals (§4.1.8): a chunk runs from ` or } to the next ` or ${. Whether a } closes an
   interpolation is decided by the brace stack in yy; if not, the action gives the text back (less). */
\`{TEMPLATE_TEXT}(?:\`|\$\{)                     return yy.templateStart(yytext, yylloc)
\}{TEMPLATE_TEXT}(?:\`|\$\{)                     return yy.templateContinue(this)
\`                                              yy.lexError("Unterminated template literal", yylloc)

"#"                                             yy.lexError("Unexpected '#'. Use the 'private' modifier for private members", yylloc)
"==="                                           yy.lexError("'===' is not supported; use '=='", yylloc)
"!=="                                           yy.lexError("'!==' is not supported; use '!='", yylloc)

"..."                                           return '...'
\?\.(?![0-9])                                   return '?.'
"=>"                                            return '=>'
">>>="                                          return '>>>='
">>>"                                           return '>>>'
">>="                                           return '>>='
"<<="                                           return '<<='
">>"                                            return '>>'
"<<"                                            return '<<'
"**="                                           return '**='
"&&="                                           return '&&='
"||="                                           return '||='
"??="                                           return '??='
"&="                                            return '&='
"|="                                            return '|='
"^="                                            return '^='
"+="                                            return '+='
"-="                                            return '-='
"*="                                            return '*='
"/="                                            return '/='
"%="                                            return '%='
"**"                                            return '**'
"++"                                            return '++'
"--"                                            return '--'
"=="                                            return '=='
"!="                                            return '!='
"<="                                            return '<='
">="                                            return '>='
"&&"                                            return '&&'
"||"                                            return '||'
"??"                                            return '??'
"{"                                             return yy.openBrace()
"}"                                             return yy.closeBrace()
"("                                             return '('
")"                                             return ')'
"["                                             return '['
"]"                                             return ']'
";"                                             return ';'
","                                             return ','
"."                                             return '.'
"?"                                             return '?'
":"                                             return ':'
"="                                             return '='
"+"                                             return '+'
"-"                                             return '-'
"*"                                             return '*'
"/"                                             return '/'
"%"                                             return '%'
"<"                                             return '<'
">"                                             return '>'
"!"                                             return '!'
"&"                                             return '&'
"|"                                             return '|'
"^"                                             return '^'
"~"                                             return '~'

<<EOF>>                                         return 'EOF'
.                                               yy.lexError("Unexpected character '" + yytext + "'", yylloc)

/lex

/* Dangling else: an `else` binds to the nearest `if`. */
%nonassoc IF_WITHOUT_ELSE
%nonassoc ELSE

%start Program

%%

/* The token filter (src/parser/token-filter.ts) inserts the `;` that ASI requires (§4.2.1). */
Program
  : StatementList EOF
    { return yy.program($1) }
  ;

StatementList
  : /* empty */
    { $$ = [] }
  | StatementList Statement
    { $$ = $1.concat([$2]) }
  ;

Statement
  : VariableDeclaration ';'
  | FunctionDeclaration
  | ClassDeclaration
  | InterfaceDeclaration
  | ImportDeclaration
  | ExportDeclaration
  | Block
  | RETURN ';'
    { $$ = yy.returnStatement(null, @$) }
  | RETURN Expression ';'
    { $$ = yy.returnStatement($2, @$) }
  | IfStatement
  | WhileStatement
  | DoWhileStatement
  | SwitchStatement
  | ForStatement
  | ForOfStatement
  | TryStatement
  | THROW Expression ';'
    { $$ = yy.throwStatement($2, @$) }
  | BREAK ';'
    { $$ = yy.jump('BreakStatement', @$) }
  | CONTINUE ';'
    { $$ = yy.jump('ContinueStatement', @$) }
  | Expression ';'
    { $$ = yy.expressionStatement($1, @$) }
  | ';'
    { $$ = yy.emptyStatement(@$) }
  ;

/* The token filter turns `function` at the start of a statement into FUNCTION_DECLARATION. */
FunctionDeclaration
  : FUNCTION_DECLARATION IDENT '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionDeclaration', { id: yy.identifier($2, @2), params: $4 }, yy.block($7, @6), @$) }
  | FUNCTION_DECLARATION '*' IDENT '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionDeclaration', { id: yy.identifier($3, @3), params: $5, generator: true }, yy.block($8, @7), @$) }
  | ASYNC FUNCTION_DECLARATION IDENT '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionDeclaration', { id: yy.identifier($3, @3), params: $5, async: true }, yy.block($8, @7), @$) }
  | ASYNC FUNCTION_DECLARATION '*' IDENT '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionDeclaration', { id: yy.identifier($4, @4), params: $6, async: true, generator: true }, yy.block($9, @8), @$) }
  ;

FunctionExpression
  : FUNCTION '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: null, params: $3 }, yy.block($6, @5), @$) }
  | FUNCTION IDENT '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: yy.identifier($2, @2), params: $4 }, yy.block($7, @6), @$) }
  | FUNCTION '*' '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: null, params: $4, generator: true }, yy.block($7, @6), @$) }
  | FUNCTION '*' IDENT '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: yy.identifier($3, @3), params: $5, generator: true }, yy.block($8, @7), @$) }
  | ASYNC FUNCTION '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: null, params: $4, async: true }, yy.block($7, @6), @$) }
  | ASYNC FUNCTION IDENT '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: yy.identifier($3, @3), params: $5, async: true }, yy.block($8, @7), @$) }
  | ASYNC FUNCTION '*' '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: null, params: $5, async: true, generator: true }, yy.block($8, @7), @$) }
  | ASYNC FUNCTION '*' IDENT '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: yy.identifier($4, @4), params: $6, async: true, generator: true }, yy.block($9, @8), @$) }
  ;

FormalParameters
  : /* empty */
    { $$ = [] }
  | ParameterList
  | ParameterList ','
  ;

ParameterList
  : Parameter
    { $$ = [$1] }
  | ParameterList ',' Parameter
    { $$ = $1.concat([$3]) }
  ;

Parameter
  : BindingTarget
  | BindingTarget '=' AssignmentExpression
    { $$ = yy.assignmentPattern($1, $3, @$) }
  | '...' IDENT
    { $$ = yy.restElement(yy.identifier($2, @2), @$) }
  ;

/* Binding patterns (§4.4.14, D40): names, object and array patterns. Pattern braces are OBJ_LBRACE (§4.2.2). */
BindingTarget
  : IDENT
    { $$ = yy.identifier($1, @$) }
  | BindingPattern
  ;

BindingPattern
  : ObjectBindingPattern
  | ArrayBindingPattern
  ;

ObjectBindingPattern
  : OBJ_LBRACE '}'
    { $$ = yy.objectPattern([], @$) }
  | OBJ_LBRACE BindingPropertyList '}'
    { $$ = yy.objectPattern($2, @$) }
  | OBJ_LBRACE BindingPropertyList ',' '}'
    { $$ = yy.objectPattern($2, @$) }
  | OBJ_LBRACE BindingRest '}'
    { $$ = yy.objectPattern([$2], @$) }
  | OBJ_LBRACE BindingPropertyList ',' BindingRest '}'
    { $$ = yy.objectPattern($2.concat([$4]), @$) }
  ;

BindingPropertyList
  : BindingProperty
    { $$ = [$1] }
  | BindingPropertyList ',' BindingProperty
    { $$ = $1.concat([$3]) }
  ;

BindingProperty
  : IDENT
    { $$ = yy.shorthandPatternProperty(yy.identifier($1, @1), null, @$) }
  | IDENT '=' AssignmentExpression
    { $$ = yy.shorthandPatternProperty(yy.identifier($1, @1), $3, @$) }
  | IDENT ':' BindingElement
    { $$ = yy.patternProperty(yy.identifier($1, @1), $3, @$) }
  | LiteralPropertyName ':' BindingElement
    { $$ = yy.patternProperty($1, $3, @$) }
  ;

BindingElement
  : BindingTarget
  | BindingTarget '=' AssignmentExpression
    { $$ = yy.assignmentPattern($1, $3, @$) }
  ;

BindingRest
  : '...' IDENT
    { $$ = yy.restElement(yy.identifier($2, @2), @$) }
  ;

ArrayBindingPattern
  : '[' ']'
    { $$ = yy.arrayPattern([], @$) }
  | '[' BindingElementList ']'
    { $$ = yy.arrayPattern($2, @$) }
  | '[' BindingElementList ',' ']'
    { $$ = yy.arrayPattern($2, @$) }
  | '[' BindingRest ']'
    { $$ = yy.arrayPattern([$2], @$) }
  | '[' BindingElementList ',' BindingRest ']'
    { $$ = yy.arrayPattern($2.concat([$4]), @$) }
  ;

BindingElementList
  : BindingElement
    { $$ = [$1] }
  | BindingElementList ',' BindingElement
    { $$ = $1.concat([$3]) }
  ;

/* Classes (§4.5). The token filter marks `class` at the start of a statement as CLASS_DECLARATION,
   the class body brace as CLASS_LBRACE, and contextual modifiers (final, override) as keywords. */
ClassDeclaration
  : CLASS_DECLARATION IDENT ClassTail
    { $$ = yy.classNode('ClassDeclaration', { id: yy.identifier($2, @2), final: false }, $3, @$) }
  | FINAL CLASS_DECLARATION IDENT ClassTail
    { $$ = yy.classNode('ClassDeclaration', { id: yy.identifier($3, @3), final: true }, $4, @$) }
  ;

ClassExpression
  : CLASS ClassTail
    { $$ = yy.classNode('ClassExpression', { id: null, final: false }, $2, @$) }
  | CLASS IDENT ClassTail
    { $$ = yy.classNode('ClassExpression', { id: yy.identifier($2, @2), final: false }, $3, @$) }
  | FINAL CLASS ClassTail
    { $$ = yy.classNode('ClassExpression', { id: null, final: true }, $3, @$) }
  | FINAL CLASS IDENT ClassTail
    { $$ = yy.classNode('ClassExpression', { id: yy.identifier($3, @3), final: true }, $4, @$) }
  ;

ClassTail
  : ClassBody
    { $$ = { superClass: null, implements: [], body: $1 } }
  | EXTENDS LeftHandSideExpression ClassBody
    { $$ = { superClass: $2, implements: [], body: $3 } }
  | IMPLEMENTS InterfaceList ClassBody
    { $$ = { superClass: null, implements: $2, body: $3 } }
  | EXTENDS LeftHandSideExpression IMPLEMENTS InterfaceList ClassBody
    { $$ = { superClass: $2, implements: $4, body: $5 } }
  ;

InterfaceList
  : LeftHandSideExpression
    { $$ = [$1] }
  | InterfaceList ',' LeftHandSideExpression
    { $$ = $1.concat([$3]) }
  ;

/* Modules (§4.7.1). The token filter emits SPEC_LBRACE for the `{` after import/export and AS/FROM in their
   clauses; parse.ts rejects module declarations outside the top level of a module. */
ImportDeclaration
  : IMPORT STRING ';'
    { $$ = yy.importDeclaration([], $2, @2, @$) }
  | IMPORT SPEC_LBRACE ImportSpecifiers '}' FROM STRING ';'
    { $$ = yy.importDeclaration($3, $6, @6, @$) }
  | IMPORT '*' AS IDENT FROM STRING ';'
    { $$ = yy.importDeclaration([yy.namespaceSpecifier(yy.identifier($4, @4), @$)], $6, @6, @$) }
  ;

ImportSpecifiers
  : /* empty */
    { $$ = [] }
  | ImportSpecifierList
  | ImportSpecifierList ','
  ;

ImportSpecifierList
  : ImportSpecifier
    { $$ = [$1] }
  | ImportSpecifierList ',' ImportSpecifier
    { $$ = $1.concat([$3]) }
  ;

ImportSpecifier
  : IDENT
    { $$ = yy.importSpecifier(yy.identifier($1, @1), yy.identifier($1, @1), @$) }
  | IDENT AS IDENT
    { $$ = yy.importSpecifier(yy.identifier($1, @1), yy.identifier($3, @3), @$) }
  ;

ExportDeclaration
  : EXPORT VariableDeclaration ';'
    { $$ = yy.exportDeclaration($2, [], null, @$) }
  | EXPORT FunctionDeclaration
    { $$ = yy.exportDeclaration($2, [], null, @$) }
  | EXPORT ClassDeclaration
    { $$ = yy.exportDeclaration($2, [], null, @$) }
  | EXPORT InterfaceDeclaration
    { $$ = yy.exportDeclaration($2, [], null, @$) }
  | EXPORT SPEC_LBRACE ExportSpecifiers '}' ';'
    { $$ = yy.exportDeclaration(null, $3, null, @$) }
  | EXPORT SPEC_LBRACE ExportSpecifiers '}' FROM STRING ';'
    { $$ = yy.exportDeclaration(null, $3, yy.moduleSource($6, @6), @$) }
  ;

ExportSpecifiers
  : /* empty */
    { $$ = [] }
  | ExportSpecifierList
  | ExportSpecifierList ','
  ;

ExportSpecifierList
  : ExportSpecifier
    { $$ = [$1] }
  | ExportSpecifierList ',' ExportSpecifier
    { $$ = $1.concat([$3]) }
  ;

ExportSpecifier
  : IDENT
    { $$ = yy.exportSpecifier(yy.identifier($1, @1), yy.identifier($1, @1), @$) }
  | IDENT AS IDENT
    { $$ = yy.exportSpecifier(yy.identifier($1, @1), yy.identifier($3, @3), @$) }
  | IDENT AS STRING
    { yy.fail('string export names are not supported', @3) }
  ;

/* Interfaces (§4.5.7). The token filter marks the body brace as CLASS_LBRACE, so members get class-body ASI. */
InterfaceDeclaration
  : INTERFACE IDENT InterfaceBody
    { $$ = yy.interfaceDeclaration(yy.identifier($2, @2), [], $3, @$) }
  | INTERFACE IDENT EXTENDS InterfaceList InterfaceBody
    { $$ = yy.interfaceDeclaration(yy.identifier($2, @2), $4, $5, @$) }
  ;

InterfaceBody
  : CLASS_LBRACE InterfaceElementList '}'
    { $$ = $2 }
  ;

InterfaceElementList
  : /* empty */
    { $$ = [] }
  | InterfaceElementList InterfaceElement
    { $$ = $2 ? $1.concat([$2]) : $1 }
  ;

InterfaceElement
  : ';'
    { $$ = null }
  | MemberModifiers InterfaceMember
    { $$ = yy.interfaceMember($1, $2, @$) }
  ;

/* Bodies and initialisers are parsed so that they can be rejected with a clear message. */
InterfaceMember
  : ClassMemberName '(' FormalParameters ')' ';'
    { $$ = { kind: 'method', key: $1, params: $3, loc: @$ } }
  | GET ClassMemberName '(' ')' ';'
    { $$ = { kind: 'get', key: $2, params: [], loc: @$ } }
  | SET ClassMemberName '(' Parameter ')' ';'
    { $$ = { kind: 'set', key: $2, params: [$4], loc: @$ } }
  | ClassMemberName ';'
    { $$ = { kind: 'property', key: $1, params: [], loc: @$ } }
  | ClassMemberName '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = { kind: 'method', key: $1, params: $3, body: true, loc: @$ } }
  | GET ClassMemberName '(' ')' BLOCK_LBRACE StatementList '}'
    { $$ = { kind: 'get', key: $2, params: [], body: true, loc: @$ } }
  | SET ClassMemberName '(' Parameter ')' BLOCK_LBRACE StatementList '}'
    { $$ = { kind: 'set', key: $2, params: [$4], body: true, loc: @$ } }
  | ClassMemberName '=' AssignmentExpression ';'
    { $$ = { kind: 'property', key: $1, params: [], initializer: true, loc: @$ } }
  ;

ClassBody
  : CLASS_LBRACE ClassElementList '}'
    { $$ = yy.classBody($2, @$) }
  ;

ClassElementList
  : /* empty */
    { $$ = [] }
  | ClassElementList ClassElement
    { $$ = $2 ? $1.concat([$2]) : $1 }
  ;

ClassElement
  : ';'
    { $$ = null }
  | MemberModifiers ClassMember
    { $$ = yy.classMember($1, $2, @$) }
  ;

MemberModifiers
  : /* empty */
    { $$ = [] }
  | MemberModifiers MemberModifier
    { $$ = $1.concat([{ name: $2.toLowerCase(), loc: @2 }]) }
  ;

MemberModifier
  : PUBLIC | PROTECTED | PRIVATE | STATIC | FINAL | OVERRIDE
  ;

ClassMember
  : ClassMemberName '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = { kind: 'method', key: $1, params: $3, body: yy.block($6, @5), loc: @$ } }
  | '*' ClassMemberName '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = { kind: 'method', key: $2, params: $4, body: yy.block($7, @6), generator: true, loc: @$ } }
  | ASYNC ClassMemberName '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = { kind: 'method', key: $2, params: $4, body: yy.block($7, @6), async: true, loc: @$ } }
  | ASYNC '*' ClassMemberName '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = { kind: 'method', key: $3, params: $5, body: yy.block($8, @7), async: true, generator: true, loc: @$ } }
  | GET ClassMemberName '(' ')' BLOCK_LBRACE StatementList '}'
    { $$ = { kind: 'get', key: $2, params: [], body: yy.block($6, @5), loc: @$ } }
  | SET ClassMemberName '(' Parameter ')' BLOCK_LBRACE StatementList '}'
    { $$ = { kind: 'set', key: $2, params: [$4], body: yy.block($7, @6), loc: @$ } }
  | ClassMemberName ';'
    { $$ = { kind: 'field', key: $1, value: null, loc: @$ } }
  | ClassMemberName '=' AssignmentExpression ';'
    { $$ = { kind: 'field', key: $1, value: $3, loc: @$ } }
  ;

ClassMemberName
  : IDENT
    { $$ = yy.identifier($1, @$) }
  | '[' AssignmentExpression ']'
    { $$ = yy.symbolMemberName($2, @$) }
  | STRING
    { $$ = yy.stringLiteral($1, @$) }
  | NUMBER
    { $$ = yy.numberLiteral($1, @$) }
  ;

IfStatement
  : IF '(' Expression ')' Statement %prec IF_WITHOUT_ELSE
    { $$ = yy.ifStatement($3, $5, null, @$) }
  | IF '(' Expression ')' Statement ELSE Statement
    { $$ = yy.ifStatement($3, $5, $7, @$) }
  ;

WhileStatement
  : WHILE '(' Expression ')' Statement
    { $$ = yy.whileStatement($3, $5, @$) }
  ;

/* The token filter ends the statement after the `)` (a `;` is inserted unless one follows), as JS ASI does. */
DoWhileStatement
  : DO Statement WHILE '(' Expression ')' ';'
    { $$ = yy.doWhileStatement($2, $5, @$) }
  ;

/* The body brace follows a header `)`, so it is a BLOCK_LBRACE and ASI applies inside (§4.2.2). */
SwitchStatement
  : SWITCH '(' Expression ')' BLOCK_LBRACE CaseClauses '}'
    { $$ = yy.switchStatement($3, $6, @$) }
  ;

CaseClauses
  : /* empty */
    { $$ = [] }
  | CaseClauses CaseClause
    { $$ = $1.concat([$2]) }
  ;

CaseClause
  : CASE Expression ':' StatementList
    { $$ = yy.switchCase($2, $4, @$) }
  | DEFAULT ':' StatementList
    { $$ = yy.switchCase(null, $3, @$) }
  ;

ForStatement
  : FOR '(' ForInit ';' OptionalExpression ';' OptionalExpression ')' Statement
    { $$ = yy.forStatement({ init: $3, test: $5, update: $7 }, $9, @$) }
  ;

TryStatement
  : TRY Block CatchClause
    { $$ = yy.tryStatement($2, $3, null, @$) }
  | TRY Block FINALLY Block
    { $$ = yy.tryStatement($2, null, $4, @$) }
  | TRY Block CatchClause FINALLY Block
    { $$ = yy.tryStatement($2, $3, $5, @$) }
  ;

CatchClause
  : CATCH '(' BindingTarget ')' Block
    { $$ = yy.catchClause($3, $5, @$) }
  | CATCH Block
    { $$ = yy.catchClause(null, $2, @$) }
  ;

/* `for (x of …)`, `for (o.x of …)` and `for ([a, b] of …)`: the target is an expression, checked by yy.forOfTarget.
   A declared name has its own rules: reducing it to a BindingTarget would conflict with Declarator (LALR). */
ForOfStatement
  : FOR '(' LET IDENT OF AssignmentExpression ')' Statement
    { $$ = yy.forOfStatement(yy.forOfDeclaration('let', yy.identifier($4, @4), @3, @4), $6, $8, @$) }
  | FOR '(' LET BindingPattern OF AssignmentExpression ')' Statement
    { $$ = yy.forOfStatement(yy.forOfDeclaration('let', $4, @3, @4), $6, $8, @$) }
  | FOR '(' CONST IDENT OF AssignmentExpression ')' Statement
    { $$ = yy.forOfStatement(yy.forOfDeclaration('const', yy.identifier($4, @4), @3, @4), $6, $8, @$) }
  | FOR '(' CONST BindingPattern OF AssignmentExpression ')' Statement
    { $$ = yy.forOfStatement(yy.forOfDeclaration('const', $4, @3, @4), $6, $8, @$) }
  | FOR '(' LeftHandSideExpression OF AssignmentExpression ')' Statement
    { $$ = yy.forOfStatement(yy.forOfTarget($3), $5, $7, @$) }
  | FOR AWAIT '(' LET IDENT OF AssignmentExpression ')' Statement
    { $$ = yy.forAwait(yy.forOfStatement(yy.forOfDeclaration('let', yy.identifier($5, @5), @4, @5), $7, $9, @$)) }
  | FOR AWAIT '(' LET BindingPattern OF AssignmentExpression ')' Statement
    { $$ = yy.forAwait(yy.forOfStatement(yy.forOfDeclaration('let', $5, @4, @5), $7, $9, @$)) }
  | FOR AWAIT '(' CONST IDENT OF AssignmentExpression ')' Statement
    { $$ = yy.forAwait(yy.forOfStatement(yy.forOfDeclaration('const', yy.identifier($5, @5), @4, @5), $7, $9, @$)) }
  | FOR AWAIT '(' CONST BindingPattern OF AssignmentExpression ')' Statement
    { $$ = yy.forAwait(yy.forOfStatement(yy.forOfDeclaration('const', $5, @4, @5), $7, $9, @$)) }
  | FOR AWAIT '(' LeftHandSideExpression OF AssignmentExpression ')' Statement
    { $$ = yy.forAwait(yy.forOfStatement(yy.forOfTarget($4), $6, $8, @$)) }
  | FOR '(' LET IDENT FOR_IN Expression ')' Statement
    { $$ = yy.forInStatement(yy.forOfDeclaration('let', yy.identifier($4, @4), @3, @4), $6, $8, @$) }
  | FOR '(' LET BindingPattern FOR_IN Expression ')' Statement
    { $$ = yy.forInStatement(yy.forOfDeclaration('let', $4, @3, @4), $6, $8, @$) }
  | FOR '(' CONST IDENT FOR_IN Expression ')' Statement
    { $$ = yy.forInStatement(yy.forOfDeclaration('const', yy.identifier($4, @4), @3, @4), $6, $8, @$) }
  | FOR '(' CONST BindingPattern FOR_IN Expression ')' Statement
    { $$ = yy.forInStatement(yy.forOfDeclaration('const', $4, @3, @4), $6, $8, @$) }
  | FOR '(' LeftHandSideExpression FOR_IN Expression ')' Statement
    { $$ = yy.forInStatement(yy.forOfTarget($3), $5, $7, @$) }
  ;

ForInit
  : /* empty */
    { $$ = null }
  | VariableDeclaration
  | Expression
  ;

OptionalExpression
  : /* empty */
    { $$ = null }
  | Expression
  ;

Block
  : BLOCK_LBRACE StatementList '}'
    { $$ = yy.block($2, @$) }
  ;

VariableDeclaration
  : LET DeclaratorList
    { $$ = yy.variableDeclaration('let', $2, @$) }
  | CONST DeclaratorList
    { $$ = yy.variableDeclaration('const', $2, @$) }
  ;

DeclaratorList
  : Declarator
    { $$ = [$1] }
  | DeclaratorList ',' Declarator
    { $$ = $1.concat([$3]) }
  ;

Declarator
  : IDENT
    { $$ = yy.declarator(yy.identifier($1, @1), null, @$) }
  | IDENT '=' AssignmentExpression
    { $$ = yy.declarator(yy.identifier($1, @1), $3, @$) }
  | BindingPattern '=' AssignmentExpression
    { $$ = yy.declarator($1, $3, @$) }
  ;

/* Expressions, lowest to highest precedence (§4.4.3). */

/* The comma operator (D55): `a, b` evaluates both and gives b. */
Expression
  : AssignmentExpression
  | Expression ',' AssignmentExpression
    { $$ = yy.sequence($1, $3, @$) }
  ;

/* The target is checked by yy.assignment: a name, a member, or an object/array literal that becomes a pattern (D40). */
AssignmentExpression
  : ConditionalExpression
  | ArrowFunction
  | YieldExpression
  | LeftHandSideExpression AssignmentOperator AssignmentExpression
    { $$ = yy.assignment($2, $1, $3, @$) }
  ;

/* The token filter marks arrow starts: ARROW_IDENT for `x =>`, ARROW_LPAREN for `( … ) =>` (§4.2.3). */
ArrowFunction
  : ARROW_IDENT '=>' ArrowBody
    { $$ = yy.arrow([yy.identifier($1, @1)], $3, @$) }
  | ARROW_LPAREN FormalParameters ')' '=>' ArrowBody
    { $$ = yy.arrow($2, $5, @$) }
  | ASYNC ARROW_IDENT '=>' ArrowBody
    { $$ = yy.arrow([yy.identifier($2, @2)], $4, @$, true) }
  | ASYNC ARROW_LPAREN FormalParameters ')' '=>' ArrowBody
    { $$ = yy.arrow($3, $6, @$, true) }
  ;

ArrowBody
  : BLOCK_LBRACE StatementList '}'
    { $$ = yy.block($2, @$) }
  | AssignmentExpression
  ;

/* Only in generator functions (checked by the compiler). Like JS, `yield` takes the lowest-precedence operand. */
YieldExpression
  : YIELD
    { $$ = yy.yieldExpression(null, false, @$) }
  | YIELD AssignmentExpression
    { $$ = yy.yieldExpression($2, false, @$) }
  | YIELD '*' AssignmentExpression
    { $$ = yy.yieldExpression($3, true, @$) }
  ;

AssignmentOperator
  : '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' | '&&=' | '||=' | '??='
  | '&=' | '|=' | '^=' | '<<=' | '>>=' | '>>>='
  ;

ConditionalExpression
  : NullishExpression
  | NullishExpression '?' AssignmentExpression ':' AssignmentExpression
    { $$ = yy.conditional($1, $3, $5, @$) }
  ;

/* Unlike JS, `??` may be mixed with `&&` and `||` without parentheses (§4.4.3). */
NullishExpression
  : OrExpression
  | NullishExpression '??' OrExpression
    { $$ = yy.logical($2, $1, $3, @$) }
  ;

OrExpression
  : AndExpression
  | OrExpression '||' AndExpression
    { $$ = yy.logical($2, $1, $3, @$) }
  ;

AndExpression
  : BitwiseOrExpression
  | AndExpression '&&' BitwiseOrExpression
    { $$ = yy.logical($2, $1, $3, @$) }
  ;

/* Bitwise operators (D50) bind tighter than && and looser than ==, as in JS: `a & b == c` is `a & (b == c)`. */
BitwiseOrExpression
  : BitwiseXorExpression
  | BitwiseOrExpression '|' BitwiseXorExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

BitwiseXorExpression
  : BitwiseAndExpression
  | BitwiseXorExpression '^' BitwiseAndExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

BitwiseAndExpression
  : EqualityExpression
  | BitwiseAndExpression '&' EqualityExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

EqualityExpression
  : RelationalExpression
  | EqualityExpression '==' RelationalExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | EqualityExpression '!=' RelationalExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

RelationalExpression
  : ShiftExpression
  | RelationalExpression '<' ShiftExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | RelationalExpression '<=' ShiftExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | RelationalExpression '>' ShiftExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | RelationalExpression '>=' ShiftExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | RelationalExpression INSTANCEOF ShiftExpression
    { $$ = yy.binary('instanceof', $1, $3, @$) }
  | RelationalExpression IN ShiftExpression
    { $$ = yy.binary('in', $1, $3, @$) }
  ;

ShiftExpression
  : AdditiveExpression
  | ShiftExpression '<<' AdditiveExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | ShiftExpression '>>' AdditiveExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | ShiftExpression '>>>' AdditiveExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

AdditiveExpression
  : MultiplicativeExpression
  | AdditiveExpression '+' MultiplicativeExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | AdditiveExpression '-' MultiplicativeExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

MultiplicativeExpression
  : UnaryExpression
  | MultiplicativeExpression '*' UnaryExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | MultiplicativeExpression '/' UnaryExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | MultiplicativeExpression '%' UnaryExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

/* `-2 ** 2` is `-(2 ** 2)` (D15): a prefix operator applies to a whole exponentiation. */
UnaryExpression
  : ExponentiationExpression
  | '!' UnaryExpression
    { $$ = yy.unary($1, $2, @$) }
  | '-' UnaryExpression
    { $$ = yy.unary($1, $2, @$) }
  | '+' UnaryExpression
    { $$ = yy.unary($1, $2, @$) }
  | '~' UnaryExpression
    { $$ = yy.unary($1, $2, @$) }
  | TYPEOF UnaryExpression
    { $$ = yy.unary('typeof', $2, @$) }
  | VOID UnaryExpression
    { $$ = yy.unary('void', $2, @$) }
  | DELETE UnaryExpression
    { $$ = yy.unary('delete', $2, @$) }
  | AWAIT UnaryExpression
    { $$ = yy.awaitExpression($2, @$) }
  | '++' UnaryExpression
    { $$ = yy.update($1, true, $2, @$) }
  | '--' UnaryExpression
    { $$ = yy.update($1, true, $2, @$) }
  ;

ExponentiationExpression
  : PostfixExpression
  | PostfixExpression '**' UnaryExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

/* A newline before postfix `++`/`--` ends the statement (the token filter inserts `;`). */
PostfixExpression
  : LeftHandSideExpression
  | LeftHandSideExpression '++'
    { $$ = yy.update($2, false, $1, @$) }
  | LeftHandSideExpression '--'
    { $$ = yy.update($2, false, $1, @$) }
  ;

/* JS-style split: `new` binds to a member chain, calls extend it (`new a.B(1).c()`). */
LeftHandSideExpression
  : MemberExpression
  | CallExpression
  | OptionalChain
    { $$ = yy.chain($1, @$) }
  ;

/* Optional chaining (D47): `a?.b`, `a?.[k]` and `f?.(x)`, continued by `.x`, `[k]` and calls. The whole chain is one
   ChainExpression (as in ESTree), which short-circuits to undefined. */
OptionalChain
  : MemberExpression OptionalLink
    { $$ = yy.optionalLink($1, $2, @$) }
  | CallExpression OptionalLink
    { $$ = yy.optionalLink($1, $2, @$) }
  | OptionalChain OptionalLink
    { $$ = yy.optionalLink($1, $2, @$) }
  | OptionalChain '.' IDENT
    { $$ = yy.member($1, yy.identifier($3, @3), false, @$) }
  | OptionalChain '[' Expression ']'
    { $$ = yy.member($1, $3, true, @$) }
  | OptionalChain Arguments
    { $$ = yy.call($1, $2, @$) }
  ;

OptionalLink
  : '?.' IDENT
    { $$ = { property: yy.identifier($2, @2), computed: false } }
  | '?.' '[' Expression ']'
    { $$ = { property: $3, computed: true } }
  | '?.' Arguments
    { $$ = { arguments: $2 } }
  ;

MemberExpression
  : PrimaryExpression
  | MemberExpression '.' IDENT
    { $$ = yy.member($1, yy.identifier($3, @3), false, @$) }
  | MemberExpression '[' Expression ']'
    { $$ = yy.member($1, $3, true, @$) }
  | NEW MemberExpression Arguments
    { $$ = yy.newExpression($2, $3, @$) }
  | SUPER '.' IDENT
    { $$ = yy.member(yy.superNode(@1), yy.identifier($3, @3), false, @$) }
  | SUPER '[' Expression ']'
    { $$ = yy.member(yy.superNode(@1), $3, true, @$) }
  ;

CallExpression
  : MemberExpression Arguments
    { $$ = yy.call($1, $2, @$) }
  | IMPORT '(' AssignmentExpression ')'
    { $$ = yy.importExpression($3, @$) }
  | IMPORT '(' AssignmentExpression ',' ')'
    { $$ = yy.importExpression($3, @$) }
  | SUPER Arguments
    { $$ = yy.call(yy.superNode(@1), $2, @$) }
  | CallExpression Arguments
    { $$ = yy.call($1, $2, @$) }
  | CallExpression '.' IDENT
    { $$ = yy.member($1, yy.identifier($3, @3), false, @$) }
  | CallExpression '[' Expression ']'
    { $$ = yy.member($1, $3, true, @$) }
  ;

Arguments
  : '(' ')'
    { $$ = [] }
  | '(' ArgumentList ')'
    { $$ = $2 }
  | '(' ArgumentList ',' ')'
    { $$ = $2 }
  ;

ArgumentList
  : Argument
    { $$ = [$1] }
  | ArgumentList ',' Argument
    { $$ = $1.concat([$3]) }
  ;

/* `f(...xs)` spreads an iterable (D46). */
Argument
  : AssignmentExpression
  | '...' AssignmentExpression
    { $$ = yy.spread($2, @$) }
  ;

PrimaryExpression
  : NUMBER
    { $$ = yy.numberLiteral($1, @$) }
  | STRING
    { $$ = yy.stringLiteral($1, @$) }
  | TemplateLiteral
  | TRUE
    { $$ = yy.literal(true, $1, @$) }
  | FALSE
    { $$ = yy.literal(false, $1, @$) }
  | NULL
    { $$ = yy.literal(null, $1, @$) }
  | UNDEFINED
    { $$ = yy.identifier($1, @$) }
  | IDENT
    { $$ = yy.identifier($1, @$) }
  | THIS
    { $$ = yy.thisExpression(@$) }
  | FunctionExpression
  | ClassExpression
  | ObjectLiteral
  | ArrayLiteral
  | '(' Expression ')'
    { $$ = yy.parenthesized($2) }
  ;

/* Object literals (§4.4.6). OBJ_LBRACE comes from the token filter's brace classification (§4.2.2). */
ObjectLiteral
  : OBJ_LBRACE '}'
    { $$ = yy.object([], @$) }
  | OBJ_LBRACE PropertyList '}'
    { $$ = yy.object($2, @$) }
  | OBJ_LBRACE PropertyList ',' '}'
    { $$ = yy.object($2, @$) }
  ;

PropertyList
  : Property
    { $$ = [$1] }
  | PropertyList ',' Property
    { $$ = $1.concat([$3]) }
  ;

/* Identifier keys have their own rules: reducing IDENT to a PropertyName first is ambiguous for LALR(1). */
Property
  : IDENT
    { $$ = yy.shorthandProperty(yy.identifier($1, @1), @$) }
  | IDENT ':' AssignmentExpression
    { $$ = yy.property(yy.identifier($1, @1), $3, false, @$) }
  | IDENT MethodTail
    { $$ = yy.property(yy.identifier($1, @1), yy.method($2, @2), true, @$) }
  | '*' IDENT MethodTail
    { $$ = yy.property(yy.identifier($2, @2), yy.method(Object.assign($3, { generator: true }), @3), true, @$) }
  | '*' LiteralPropertyName MethodTail
    { $$ = yy.property($2, yy.method(Object.assign($3, { generator: true }), @3), true, @$) }
  | ASYNC IDENT MethodTail
    { $$ = yy.property(yy.identifier($2, @2), yy.method(Object.assign($3, { async: true }), @3), true, @$) }
  | ASYNC '*' IDENT MethodTail
    { $$ = yy.property(yy.identifier($3, @3), yy.method(Object.assign($4, { async: true, generator: true }), @4), true, @$) }
  | ASYNC '*' LiteralPropertyName MethodTail
    { $$ = yy.property($3, yy.method(Object.assign($4, { async: true, generator: true }), @4), true, @$) }
  | ASYNC '*' '[' AssignmentExpression ']' MethodTail
    { $$ = yy.computed(yy.property($4, yy.method(Object.assign($6, { async: true, generator: true }), @6), true, @$)) }
  | ASYNC LiteralPropertyName MethodTail
    { $$ = yy.property($2, yy.method(Object.assign($3, { async: true }), @3), true, @$) }
  | LiteralPropertyName ':' AssignmentExpression
    { $$ = yy.property($1, $3, false, @$) }
  | LiteralPropertyName MethodTail
    { $$ = yy.property($1, yy.method($2, @2), true, @$) }
  | IDENT '=' AssignmentExpression
    { $$ = yy.coverInitializedName(yy.identifier($1, @1), $3, @$) }
  | '...' AssignmentExpression
    { $$ = yy.spread($2, @$) }
  | '[' AssignmentExpression ']' ':' AssignmentExpression
    { $$ = yy.computed(yy.property($2, $5, false, @$)) }
  | '[' AssignmentExpression ']' MethodTail
    { $$ = yy.computed(yy.property($2, yy.method($4, @4), true, @$)) }
  | '*' '[' AssignmentExpression ']' MethodTail
    { $$ = yy.computed(yy.property($3, yy.method(Object.assign($5, { generator: true }), @5), true, @$)) }
  | ASYNC '[' AssignmentExpression ']' MethodTail
    { $$ = yy.computed(yy.property($3, yy.method(Object.assign($5, { async: true }), @5), true, @$)) }
  | GET '[' AssignmentExpression ']' '(' ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.computed(yy.accessorProperty('get', $3, yy.method({ params: [], body: yy.block($8, @7) }, @5), @$)) }
  | SET '[' AssignmentExpression ']' '(' Parameter ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.computed(yy.accessorProperty('set', $3, yy.method({ params: [$6], body: yy.block($9, @8) }, @5), @$)) }
  | GET PropertyKey '(' ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.accessorProperty('get', $2, yy.method({ params: [], body: yy.block($6, @5) }, @3), @$) }
  | SET PropertyKey '(' Parameter ')' BLOCK_LBRACE StatementList '}'
    { $$ = yy.accessorProperty('set', $2, yy.method({ params: [$4], body: yy.block($7, @6) }, @3), @$) }
  ;

PropertyKey
  : IDENT
    { $$ = yy.identifier($1, @$) }
  | LiteralPropertyName
  ;

MethodTail
  : '(' FormalParameters ')' BLOCK_LBRACE StatementList '}'
    { $$ = { params: $2, body: yy.block($5, @4) } }
  ;

LiteralPropertyName
  : STRING
    { $$ = yy.stringLiteral($1, @$) }
  | NUMBER
    { $$ = yy.numberLiteral($1, @$) }
  ;

/* Array literals (§4.4.7): no holes, trailing comma allowed. `...x` spreads (D46), or is the rest of a pattern (D40). */
ArrayLiteral
  : '[' ']'
    { $$ = yy.array([], @$) }
  | '[' ElementList ']'
    { $$ = yy.array($2, @$) }
  | '[' ElementList ',' ']'
    { $$ = yy.array($2, @$) }
  ;

ElementList
  : Element
    { $$ = [$1] }
  | ElementList ',' Element
    { $$ = $1.concat([$3]) }
  ;

Element
  : AssignmentExpression
  | '...' AssignmentExpression
    { $$ = yy.spread($2, @$) }
  ;

/* Template literals (§4.1.8, D34): quasis and substitutions alternate. */
TemplateLiteral
  : TEMPLATE_FULL
    { $$ = yy.template([yy.quasi($1, @1, true)], [], @$) }
  | TEMPLATE_HEAD Expression TemplateRest
    { $$ = yy.template([yy.quasi($1, @1, false)].concat($3.quasis), [$2].concat($3.expressions), @$) }
  ;

TemplateRest
  : TEMPLATE_TAIL
    { $$ = { quasis: [yy.quasi($1, @1, true)], expressions: [] } }
  | TEMPLATE_MIDDLE Expression TemplateRest
    { $$ = { quasis: [yy.quasi($1, @1, false)].concat($3.quasis), expressions: [$2].concat($3.expressions) } }
  ;
