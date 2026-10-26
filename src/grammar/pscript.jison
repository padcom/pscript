/* PScript lexer and grammar (§4.1, §4.3).
 * Actions build nodes through the `yy` helpers installed by `src/parser/parse.ts`;
 * locations come from `@n` / `@$` (Jison yylloc) and are converted there.
 */

%lex

DIGITS          [0-9]+
EXPONENT        [eE][+-]?{DIGITS}
NUMBER          (({DIGITS}"."{DIGITS}?)|("."{DIGITS})|{DIGITS}){EXPONENT}?
IDENT           [A-Za-z_$][A-Za-z0-9_$]*

%%

[ \t\v\f\u00A0\uFEFF]+                         /* skip whitespace */
\r\n|[\n\r]                                     return 'NEWLINE'
[\u2028\u2029]                                  return yy.lineSeparator(this)
"//"[^\n\r\u2028\u2029]*                          /* skip line comment */
"/*"[\s\S]*?"*/"                                return yy.blockComment(yytext)
"/*"                                            yy.lexError("Unterminated comment", yylloc)

{NUMBER}                                        return yy.numberToken(yytext, yylloc, this._input)

\"([^"\\\r\n\u2028\u2029]|\\(\r\n|[\s\S]))*\"     return 'STRING'
\'([^'\\\r\n\u2028\u2029]|\\(\r\n|[\s\S]))*\'     return 'STRING'
["']                                            yy.lexError("Unterminated string", yylloc)

{IDENT}                                         return yy.identToken(yytext, yylloc)

"#"                                             yy.lexError("Unexpected '#'. Use the 'private' modifier for private members", yylloc)
"==="                                           yy.lexError("'===' is not supported; use '=='", yylloc)
"!=="                                           yy.lexError("'!==' is not supported; use '!='", yylloc)

"..."                                           return '...'
"?."                                            return '?.'
"=>"                                            return '=>'
"**="                                           return '**='
"&&="                                           return '&&='
"||="                                           return '||='
"??="                                           return '??='
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
"{"                                             return '{'
"}"                                             return '}'
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
  | Block
  | RETURN ';'
    { $$ = yy.returnStatement(null, @$) }
  | RETURN Expression ';'
    { $$ = yy.returnStatement($2, @$) }
  | IfStatement
  | WhileStatement
  | ForStatement
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
  : FUNCTION_DECLARATION IDENT '(' FormalParameters ')' '{' StatementList '}'
    { $$ = yy.functionNode('FunctionDeclaration', { id: yy.identifier($2, @2), params: $4 }, yy.block($7, @6), @$) }
  ;

FunctionExpression
  : FUNCTION '(' FormalParameters ')' '{' StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: null, params: $3 }, yy.block($6, @5), @$) }
  | FUNCTION IDENT '(' FormalParameters ')' '{' StatementList '}'
    { $$ = yy.functionNode('FunctionExpression', { id: yy.identifier($2, @2), params: $4 }, yy.block($7, @6), @$) }
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
  : IDENT
    { $$ = yy.identifier($1, @$) }
  | IDENT '=' AssignmentExpression
    { $$ = yy.assignmentPattern(yy.identifier($1, @1), $3, @$) }
  | '...' IDENT
    { $$ = yy.restElement(yy.identifier($2, @2), @$) }
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

ForStatement
  : FOR '(' ForInit ';' OptionalExpression ';' OptionalExpression ')' Statement
    { $$ = yy.forStatement({ init: $3, test: $5, update: $7 }, $9, @$) }
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
  : '{' StatementList '}'
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
  ;

/* Expressions, lowest to highest precedence (§4.4.3). */

Expression
  : AssignmentExpression
  ;

/* The target is checked by yy.assignment (Identifier or, later, MemberExpression). */
AssignmentExpression
  : ConditionalExpression
  | ArrowFunction
  | CallExpression AssignmentOperator AssignmentExpression
    { $$ = yy.assignment($2, $1, $3, @$) }
  ;

/* The token filter marks arrow starts: ARROW_IDENT for `x =>`, ARROW_LPAREN for `( … ) =>` (§4.2.3). */
ArrowFunction
  : ARROW_IDENT '=>' ArrowBody
    { $$ = yy.arrow([yy.identifier($1, @1)], $3, @$) }
  | ARROW_LPAREN FormalParameters ')' '=>' ArrowBody
    { $$ = yy.arrow($2, $5, @$) }
  ;

ArrowBody
  : '{' StatementList '}'
    { $$ = yy.block($2, @$) }
  | AssignmentExpression
  ;

AssignmentOperator
  : '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' | '&&=' | '||=' | '??='
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
  : EqualityExpression
  | AndExpression '&&' EqualityExpression
    { $$ = yy.logical($2, $1, $3, @$) }
  ;

EqualityExpression
  : RelationalExpression
  | EqualityExpression '==' RelationalExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | EqualityExpression '!=' RelationalExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

RelationalExpression
  : AdditiveExpression
  | RelationalExpression '<' AdditiveExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | RelationalExpression '<=' AdditiveExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | RelationalExpression '>' AdditiveExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | RelationalExpression '>=' AdditiveExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | RelationalExpression INSTANCEOF AdditiveExpression
    { $$ = yy.binary('instanceof', $1, $3, @$) }
  | RelationalExpression IN AdditiveExpression
    { $$ = yy.binary('in', $1, $3, @$) }
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
  | TYPEOF UnaryExpression
    { $$ = yy.unary('typeof', $2, @$) }
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
  : CallExpression
  | CallExpression '++'
    { $$ = yy.update($2, false, $1, @$) }
  | CallExpression '--'
    { $$ = yy.update($2, false, $1, @$) }
  ;

CallExpression
  : PrimaryExpression
  | NEW PrimaryExpression Arguments
    { $$ = yy.newExpression($2, $3, @$) }
  | CallExpression Arguments
    { $$ = yy.call($1, $2, @$) }
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
  : Expression
    { $$ = [$1] }
  | ArgumentList ',' Expression
    { $$ = $1.concat([$3]) }
  ;

PrimaryExpression
  : NUMBER
    { $$ = yy.numberLiteral($1, @$) }
  | STRING
    { $$ = yy.stringLiteral($1, @$) }
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
  | '(' Expression ')'
    { $$ = $2 }
  ;
