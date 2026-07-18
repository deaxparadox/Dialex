# GENERATED FILE — never hand-edit (decision 9). Regenerate with:
#   sqlacodegen --generator tables "$DATABASE_URL" > app/core/generated_tables.py
# Django owns this schema; regenerate whenever its migrations change.
# Custom query logic goes in a separate file that imports from this one.

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, DateTime, Double, ForeignKeyConstraint, Identity, Index, Integer, MetaData, PrimaryKeyConstraint, SmallInteger, String, Table, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()


t_accounts_user = Table(
    'accounts_user', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('password', String(128), nullable=False),
    Column('last_login', DateTime(True)),
    Column('is_superuser', Boolean, nullable=False),
    Column('username', String(150), nullable=False),
    Column('first_name', String(150), nullable=False),
    Column('last_name', String(150), nullable=False),
    Column('email', String(254), nullable=False),
    Column('is_staff', Boolean, nullable=False),
    Column('is_active', Boolean, nullable=False),
    Column('date_joined', DateTime(True), nullable=False),
    PrimaryKeyConstraint('id', name='accounts_user_pkey'),
    UniqueConstraint('username', name='accounts_user_username_key'),
    Index('accounts_user_username_6088629e_like', 'username', postgresql_ops={'username': 'varchar_pattern_ops'})
)

t_auth_group = Table(
    'auth_group', metadata,
    Column('id', Integer, Identity(start=1, increment=1, minvalue=1, maxvalue=2147483647, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('name', String(150), nullable=False),
    PrimaryKeyConstraint('id', name='auth_group_pkey'),
    UniqueConstraint('name', name='auth_group_name_key'),
    Index('auth_group_name_a6ea08ec_like', 'name', postgresql_ops={'name': 'varchar_pattern_ops'})
)

t_debates_agentpersona = Table(
    'debates_agentpersona', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('name', String(255), nullable=False),
    Column('role', String(20), nullable=False),
    Column('role_description', Text, nullable=False),
    Column('system_prompt', Text, nullable=False),
    Column('model_config', JSONB, nullable=False),
    PrimaryKeyConstraint('id', name='debates_agentpersona_pkey')
)

t_django_content_type = Table(
    'django_content_type', metadata,
    Column('id', Integer, Identity(start=1, increment=1, minvalue=1, maxvalue=2147483647, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('app_label', String(100), nullable=False),
    Column('model', String(100), nullable=False),
    PrimaryKeyConstraint('id', name='django_content_type_pkey'),
    UniqueConstraint('app_label', 'model', name='django_content_type_app_label_model_76bd3d3b_uniq')
)

t_django_migrations = Table(
    'django_migrations', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('app', String(255), nullable=False),
    Column('name', String(255), nullable=False),
    Column('applied', DateTime(True), nullable=False),
    PrimaryKeyConstraint('id', name='django_migrations_pkey')
)

t_django_session = Table(
    'django_session', metadata,
    Column('session_key', String(40), primary_key=True),
    Column('session_data', Text, nullable=False),
    Column('expire_date', DateTime(True), nullable=False),
    PrimaryKeyConstraint('session_key', name='django_session_pkey'),
    Index('django_session_expire_date_a5c62663', 'expire_date'),
    Index('django_session_session_key_c0390e0f_like', 'session_key', postgresql_ops={'session_key': 'varchar_pattern_ops'})
)

t_accounts_user_groups = Table(
    'accounts_user_groups', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('user_id', BigInteger, nullable=False),
    Column('group_id', Integer, nullable=False),
    ForeignKeyConstraint(['group_id'], ['auth_group.id'], deferrable=True, initially='DEFERRED', name='accounts_user_groups_group_id_bd11a704_fk_auth_group_id'),
    ForeignKeyConstraint(['user_id'], ['accounts_user.id'], deferrable=True, initially='DEFERRED', name='accounts_user_groups_user_id_52b62117_fk_accounts_user_id'),
    PrimaryKeyConstraint('id', name='accounts_user_groups_pkey'),
    UniqueConstraint('user_id', 'group_id', name='accounts_user_groups_user_id_group_id_59c0b32f_uniq'),
    Index('accounts_user_groups_group_id_bd11a704', 'group_id'),
    Index('accounts_user_groups_user_id_52b62117', 'user_id')
)

t_auth_permission = Table(
    'auth_permission', metadata,
    Column('id', Integer, Identity(start=1, increment=1, minvalue=1, maxvalue=2147483647, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('name', String(255), nullable=False),
    Column('content_type_id', Integer, nullable=False),
    Column('codename', String(100), nullable=False),
    ForeignKeyConstraint(['content_type_id'], ['django_content_type.id'], deferrable=True, initially='DEFERRED', name='auth_permission_content_type_id_2f476e4b_fk_django_co'),
    PrimaryKeyConstraint('id', name='auth_permission_pkey'),
    UniqueConstraint('content_type_id', 'codename', name='auth_permission_content_type_id_codename_01ab375a_uniq'),
    Index('auth_permission_content_type_id_2f476e4b', 'content_type_id')
)

t_cases_casetypeconfig = Table(
    'cases_casetypeconfig', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('type', String(100), nullable=False),
    Column('position_options', JSONB, nullable=False),
    Column('decision_options', JSONB, nullable=False),
    Column('research_guardrail_prompt', Text, nullable=False),
    Column('default_consultant_persona_id', BigInteger, nullable=False),
    Column('default_judge_persona_id', BigInteger, nullable=False),
    Column('default_max_rounds', Integer, nullable=False),
    CheckConstraint('default_max_rounds >= 0', name='cases_casetypeconfig_default_max_rounds_check'),
    ForeignKeyConstraint(['default_consultant_persona_id'], ['debates_agentpersona.id'], deferrable=True, initially='DEFERRED', name='cases_casetypeconfig_default_consultant_p_2ff5aaa3_fk_debates_a'),
    ForeignKeyConstraint(['default_judge_persona_id'], ['debates_agentpersona.id'], deferrable=True, initially='DEFERRED', name='cases_casetypeconfig_default_judge_person_f1a6264c_fk_debates_a'),
    PrimaryKeyConstraint('id', name='cases_casetypeconfig_pkey'),
    UniqueConstraint('type', name='cases_casetypeconfig_type_key'),
    Index('cases_casetypeconfig_default_consultant_persona_id_2ff5aaa3', 'default_consultant_persona_id'),
    Index('cases_casetypeconfig_default_judge_persona_id_f1a6264c', 'default_judge_persona_id'),
    Index('cases_casetypeconfig_type_5692f14e_like', 'type', postgresql_ops={'type': 'varchar_pattern_ops'})
)

t_consultations_consultationsession = Table(
    'consultations_consultationsession', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('case_type', String(100), nullable=False),
    Column('status', String(20), nullable=False),
    Column('finalized_payload', JSONB),
    Column('created_at', DateTime(True), nullable=False),
    Column('approved_at', DateTime(True)),
    Column('consultant_persona_id', BigInteger, nullable=False),
    Column('user_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['consultant_persona_id'], ['debates_agentpersona.id'], deferrable=True, initially='DEFERRED', name='consultations_consul_consultant_persona_i_5049978e_fk_debates_a'),
    ForeignKeyConstraint(['user_id'], ['accounts_user.id'], deferrable=True, initially='DEFERRED', name='consultations_consul_user_id_b287bc20_fk_accounts_'),
    PrimaryKeyConstraint('id', name='consultations_consultationsession_pkey'),
    Index('consultations_consultation_consultant_persona_id_5049978e', 'consultant_persona_id'),
    Index('consultations_consultationsession_user_id_b287bc20', 'user_id')
)

t_django_admin_log = Table(
    'django_admin_log', metadata,
    Column('id', Integer, Identity(start=1, increment=1, minvalue=1, maxvalue=2147483647, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('action_time', DateTime(True), nullable=False),
    Column('object_id', Text),
    Column('object_repr', String(200), nullable=False),
    Column('action_flag', SmallInteger, nullable=False),
    Column('change_message', Text, nullable=False),
    Column('content_type_id', Integer),
    Column('user_id', BigInteger, nullable=False),
    CheckConstraint('action_flag >= 0', name='django_admin_log_action_flag_check'),
    ForeignKeyConstraint(['content_type_id'], ['django_content_type.id'], deferrable=True, initially='DEFERRED', name='django_admin_log_content_type_id_c4bce8eb_fk_django_co'),
    ForeignKeyConstraint(['user_id'], ['accounts_user.id'], deferrable=True, initially='DEFERRED', name='django_admin_log_user_id_c564eba6_fk_accounts_user_id'),
    PrimaryKeyConstraint('id', name='django_admin_log_pkey'),
    Index('django_admin_log_content_type_id_c4bce8eb', 'content_type_id'),
    Index('django_admin_log_user_id_c564eba6', 'user_id')
)

t_token_blacklist_outstandingtoken = Table(
    'token_blacklist_outstandingtoken', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('token', Text, nullable=False),
    Column('created_at', DateTime(True)),
    Column('expires_at', DateTime(True), nullable=False),
    Column('user_id', BigInteger),
    Column('jti', String(255), nullable=False),
    ForeignKeyConstraint(['user_id'], ['accounts_user.id'], deferrable=True, initially='DEFERRED', name='token_blacklist_outs_user_id_83bc629a_fk_accounts_'),
    PrimaryKeyConstraint('id', name='token_blacklist_outstandingtoken_pkey'),
    UniqueConstraint('jti', name='token_blacklist_outstandingtoken_jti_hex_d9bdf6f7_uniq'),
    Index('token_blacklist_outstandingtoken_jti_hex_d9bdf6f7_like', 'jti', postgresql_ops={'jti': 'varchar_pattern_ops'}),
    Index('token_blacklist_outstandingtoken_user_id_83bc629a', 'user_id')
)

t_accounts_user_user_permissions = Table(
    'accounts_user_user_permissions', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('user_id', BigInteger, nullable=False),
    Column('permission_id', Integer, nullable=False),
    ForeignKeyConstraint(['permission_id'], ['auth_permission.id'], deferrable=True, initially='DEFERRED', name='accounts_user_user_p_permission_id_113bb443_fk_auth_perm'),
    ForeignKeyConstraint(['user_id'], ['accounts_user.id'], deferrable=True, initially='DEFERRED', name='accounts_user_user_p_user_id_e4f0a161_fk_accounts_'),
    PrimaryKeyConstraint('id', name='accounts_user_user_permissions_pkey'),
    UniqueConstraint('user_id', 'permission_id', name='accounts_user_user_permi_user_id_permission_id_2ab516c2_uniq'),
    Index('accounts_user_user_permissions_permission_id_113bb443', 'permission_id'),
    Index('accounts_user_user_permissions_user_id_e4f0a161', 'user_id')
)

t_auth_group_permissions = Table(
    'auth_group_permissions', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('group_id', Integer, nullable=False),
    Column('permission_id', Integer, nullable=False),
    ForeignKeyConstraint(['group_id'], ['auth_group.id'], deferrable=True, initially='DEFERRED', name='auth_group_permissions_group_id_b120cbf9_fk_auth_group_id'),
    ForeignKeyConstraint(['permission_id'], ['auth_permission.id'], deferrable=True, initially='DEFERRED', name='auth_group_permissio_permission_id_84c5c92e_fk_auth_perm'),
    PrimaryKeyConstraint('id', name='auth_group_permissions_pkey'),
    UniqueConstraint('group_id', 'permission_id', name='auth_group_permissions_group_id_permission_id_0cd325b0_uniq'),
    Index('auth_group_permissions_group_id_b120cbf9', 'group_id'),
    Index('auth_group_permissions_permission_id_84c5c92e', 'permission_id')
)

t_cases_case = Table(
    'cases_case', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('type', String(100), nullable=False),
    Column('payload', JSONB, nullable=False),
    Column('status', String(50), nullable=False),
    Column('created_at', DateTime(True), nullable=False),
    Column('consultation_session_id', BigInteger),
    Column('created_by_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['consultation_session_id'], ['consultations_consultationsession.id'], deferrable=True, initially='DEFERRED', name='cases_case_consultation_session_a99b001a_fk_consultat'),
    ForeignKeyConstraint(['created_by_id'], ['accounts_user.id'], deferrable=True, initially='DEFERRED', name='cases_case_created_by_id_91d115ec_fk_accounts_user_id'),
    PrimaryKeyConstraint('id', name='cases_case_pkey'),
    UniqueConstraint('consultation_session_id', name='cases_case_consultation_session_id_key'),
    Index('cases_case_created_by_id_91d115ec', 'created_by_id')
)

t_cases_casetypeconfig_default_participant_personas = Table(
    'cases_casetypeconfig_default_participant_personas', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('casetypeconfig_id', BigInteger, nullable=False),
    Column('agentpersona_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['agentpersona_id'], ['debates_agentpersona.id'], deferrable=True, initially='DEFERRED', name='cases_casetypeconfig_agentpersona_id_ea3b76b2_fk_debates_a'),
    ForeignKeyConstraint(['casetypeconfig_id'], ['cases_casetypeconfig.id'], deferrable=True, initially='DEFERRED', name='cases_casetypeconfig_casetypeconfig_id_5e001dce_fk_cases_cas'),
    PrimaryKeyConstraint('id', name='cases_casetypeconfig_default_participant_personas_pkey'),
    UniqueConstraint('casetypeconfig_id', 'agentpersona_id', name='cases_casetypeconfig_def_casetypeconfig_id_agentp_15bf66de_uniq'),
    Index('cases_casetypeconfig_defau_agentpersona_id_ea3b76b2', 'agentpersona_id'),
    Index('cases_casetypeconfig_defau_casetypeconfig_id_5e001dce', 'casetypeconfig_id')
)

t_consultations_consultationturn = Table(
    'consultations_consultationturn', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('turn_number', Integer, nullable=False),
    Column('speaker', String(20), nullable=False),
    Column('content', Text, nullable=False),
    Column('created_at', DateTime(True), nullable=False),
    Column('session_id', BigInteger, nullable=False),
    CheckConstraint('turn_number >= 0', name='consultations_consultationturn_turn_number_check'),
    ForeignKeyConstraint(['session_id'], ['consultations_consultationsession.id'], deferrable=True, initially='DEFERRED', name='consultations_consul_session_id_92af34c5_fk_consultat'),
    PrimaryKeyConstraint('id', name='consultations_consultationturn_pkey'),
    UniqueConstraint('session_id', 'turn_number', name='consultations_consultati_session_id_turn_number_4a366c04_uniq'),
    Index('consultations_consultationturn_session_id_92af34c5', 'session_id')
)

t_token_blacklist_blacklistedtoken = Table(
    'token_blacklist_blacklistedtoken', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('blacklisted_at', DateTime(True), nullable=False),
    Column('token_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['token_id'], ['token_blacklist_outstandingtoken.id'], deferrable=True, initially='DEFERRED', name='token_blacklist_blacklistedtoken_token_id_3cc7fe56_fk'),
    PrimaryKeyConstraint('id', name='token_blacklist_blacklistedtoken_pkey'),
    UniqueConstraint('token_id', name='token_blacklist_blacklistedtoken_token_id_key')
)

t_debates_debate = Table(
    'debates_debate', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('turn_strategy', String(20), nullable=False),
    Column('status', String(20), nullable=False),
    Column('current_round', Integer, nullable=False),
    Column('max_rounds', Integer, nullable=False),
    Column('convergence_config', JSONB, nullable=False),
    Column('opening_statement', Text),
    Column('closing_summary', Text),
    Column('created_at', DateTime(True), nullable=False),
    Column('judged_at', DateTime(True)),
    Column('case_id', BigInteger, nullable=False),
    Column('judge_persona_id', BigInteger, nullable=False),
    CheckConstraint('current_round >= 0', name='debates_debate_current_round_check'),
    CheckConstraint('max_rounds >= 0', name='debates_debate_max_rounds_check'),
    ForeignKeyConstraint(['case_id'], ['cases_case.id'], deferrable=True, initially='DEFERRED', name='debates_debate_case_id_f6caac20_fk_cases_case_id'),
    ForeignKeyConstraint(['judge_persona_id'], ['debates_agentpersona.id'], deferrable=True, initially='DEFERRED', name='debates_debate_judge_persona_id_691fc886_fk_debates_a'),
    PrimaryKeyConstraint('id', name='debates_debate_pkey'),
    Index('debates_debate_case_id_f6caac20', 'case_id'),
    Index('debates_debate_judge_persona_id_691fc886', 'judge_persona_id')
)

t_debates_convergencecheck = Table(
    'debates_convergencecheck', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('round_number', Integer, nullable=False),
    Column('method', String(50), nullable=False),
    Column('signals', JSONB, nullable=False),
    Column('result', Boolean, nullable=False),
    Column('score', Double(53), nullable=False),
    Column('created_at', DateTime(True), nullable=False),
    Column('debate_id', BigInteger, nullable=False),
    CheckConstraint('round_number >= 0', name='debates_convergencecheck_round_number_check'),
    ForeignKeyConstraint(['debate_id'], ['debates_debate.id'], deferrable=True, initially='DEFERRED', name='debates_convergencec_debate_id_2a9cef03_fk_debates_d'),
    PrimaryKeyConstraint('id', name='debates_convergencecheck_pkey'),
    Index('debates_convergencecheck_debate_id_2a9cef03', 'debate_id')
)

t_debates_debateparticipant = Table(
    'debates_debateparticipant', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('stance_seed', Text),
    Column('persona_snapshot', JSONB, nullable=False),
    Column('agent_persona_id', BigInteger, nullable=False),
    Column('debate_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['agent_persona_id'], ['debates_agentpersona.id'], deferrable=True, initially='DEFERRED', name='debates_debatepartic_agent_persona_id_28ed25ce_fk_debates_a'),
    ForeignKeyConstraint(['debate_id'], ['debates_debate.id'], deferrable=True, initially='DEFERRED', name='debates_debatepartic_debate_id_3138119b_fk_debates_d'),
    PrimaryKeyConstraint('id', name='debates_debateparticipant_pkey'),
    UniqueConstraint('debate_id', 'agent_persona_id', name='debates_debateparticipan_debate_id_agent_persona__1131c181_uniq'),
    Index('debates_debateparticipant_agent_persona_id_28ed25ce', 'agent_persona_id'),
    Index('debates_debateparticipant_debate_id_3138119b', 'debate_id')
)

t_debates_researchfinding = Table(
    'debates_researchfinding', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('query', Text, nullable=False),
    Column('source_url', Text),
    Column('source_title', Text),
    Column('summary', Text, nullable=False),
    Column('created_at', DateTime(True), nullable=False),
    Column('agent_persona_id', BigInteger, nullable=False),
    Column('debate_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['agent_persona_id'], ['debates_agentpersona.id'], deferrable=True, initially='DEFERRED', name='debates_researchfind_agent_persona_id_c177d2fe_fk_debates_a'),
    ForeignKeyConstraint(['debate_id'], ['debates_debate.id'], deferrable=True, initially='DEFERRED', name='debates_researchfinding_debate_id_6b539ad3_fk_debates_debate_id'),
    PrimaryKeyConstraint('id', name='debates_researchfinding_pkey'),
    Index('debates_researchfinding_agent_persona_id_c177d2fe', 'agent_persona_id'),
    Index('debates_researchfinding_debate_id_6b539ad3', 'debate_id')
)

t_debates_verdict = Table(
    'debates_verdict', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('decision', String(255), nullable=False),
    Column('confidence', Double(53), nullable=False),
    Column('reasoning', Text, nullable=False),
    Column('created_at', DateTime(True), nullable=False),
    Column('debate_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['debate_id'], ['debates_debate.id'], deferrable=True, initially='DEFERRED', name='debates_verdict_debate_id_96f06ff0_fk_debates_debate_id'),
    PrimaryKeyConstraint('id', name='debates_verdict_pkey'),
    UniqueConstraint('debate_id', name='debates_verdict_debate_id_key')
)

t_notifications_notification = Table(
    'notifications_notification', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('type', String(100), nullable=False),
    Column('message', Text, nullable=False),
    Column('read', Boolean, nullable=False),
    Column('created_at', DateTime(True), nullable=False),
    Column('related_case_id', BigInteger),
    Column('related_debate_id', BigInteger),
    Column('user_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['related_case_id'], ['cases_case.id'], deferrable=True, initially='DEFERRED', name='notifications_notifi_related_case_id_5a45c0a0_fk_cases_cas'),
    ForeignKeyConstraint(['related_debate_id'], ['debates_debate.id'], deferrable=True, initially='DEFERRED', name='notifications_notifi_related_debate_id_cd91608d_fk_debates_d'),
    ForeignKeyConstraint(['user_id'], ['accounts_user.id'], deferrable=True, initially='DEFERRED', name='notifications_notification_user_id_b5e8c0ff_fk_accounts_user_id'),
    PrimaryKeyConstraint('id', name='notifications_notification_pkey'),
    Index('notifications_notification_related_case_id_5a45c0a0', 'related_case_id'),
    Index('notifications_notification_related_debate_id_cd91608d', 'related_debate_id'),
    Index('notifications_notification_user_id_b5e8c0ff', 'user_id')
)

t_reviews_humanreview = Table(
    'reviews_humanreview', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('comment', Text, nullable=False),
    Column('final_decision', String(255)),
    Column('reviewed_at', DateTime(True), nullable=False),
    Column('debate_id', BigInteger, nullable=False),
    Column('reviewer_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['debate_id'], ['debates_debate.id'], deferrable=True, initially='DEFERRED', name='reviews_humanreview_debate_id_461d2a44_fk_debates_debate_id'),
    ForeignKeyConstraint(['reviewer_id'], ['accounts_user.id'], deferrable=True, initially='DEFERRED', name='reviews_humanreview_reviewer_id_54050dc1_fk_accounts_user_id'),
    PrimaryKeyConstraint('id', name='reviews_humanreview_pkey'),
    UniqueConstraint('debate_id', name='reviews_humanreview_debate_id_key'),
    Index('reviews_humanreview_reviewer_id_54050dc1', 'reviewer_id')
)

t_debates_argument = Table(
    'debates_argument', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('round_number', Integer, nullable=False),
    Column('content', Text, nullable=False),
    Column('position', String(255)),
    Column('confidence', Double(53)),
    Column('created_at', DateTime(True), nullable=False),
    Column('agent_persona_id', BigInteger, nullable=False),
    Column('responds_to_id', BigInteger),
    Column('debate_id', BigInteger, nullable=False),
    Column('cites_research_finding_id', BigInteger),
    CheckConstraint('round_number >= 0', name='debates_argument_round_number_check'),
    ForeignKeyConstraint(['agent_persona_id'], ['debates_agentpersona.id'], deferrable=True, initially='DEFERRED', name='debates_argument_agent_persona_id_a7bd8bea_fk_debates_a'),
    ForeignKeyConstraint(['cites_research_finding_id'], ['debates_researchfinding.id'], deferrable=True, initially='DEFERRED', name='debates_argument_cites_research_findi_7c245c6a_fk_debates_r'),
    ForeignKeyConstraint(['debate_id'], ['debates_debate.id'], deferrable=True, initially='DEFERRED', name='debates_argument_debate_id_a5ddc3ff_fk_debates_debate_id'),
    ForeignKeyConstraint(['responds_to_id'], ['debates_argument.id'], deferrable=True, initially='DEFERRED', name='debates_argument_responds_to_id_e9888d09_fk_debates_argument_id'),
    PrimaryKeyConstraint('id', name='debates_argument_pkey'),
    Index('debates_argument_agent_persona_id_a7bd8bea', 'agent_persona_id'),
    Index('debates_argument_cites_research_finding_id_7c245c6a', 'cites_research_finding_id'),
    Index('debates_argument_debate_id_a5ddc3ff', 'debate_id'),
    Index('debates_argument_responds_to_id_e9888d09', 'responds_to_id')
)

t_debates_verdict_cited_arguments = Table(
    'debates_verdict_cited_arguments', metadata,
    Column('id', BigInteger, Identity(start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1), primary_key=True, autoincrement=True),
    Column('verdict_id', BigInteger, nullable=False),
    Column('argument_id', BigInteger, nullable=False),
    ForeignKeyConstraint(['argument_id'], ['debates_argument.id'], deferrable=True, initially='DEFERRED', name='debates_verdict_cite_argument_id_19f8cee6_fk_debates_a'),
    ForeignKeyConstraint(['verdict_id'], ['debates_verdict.id'], deferrable=True, initially='DEFERRED', name='debates_verdict_cite_verdict_id_1b627db4_fk_debates_v'),
    PrimaryKeyConstraint('id', name='debates_verdict_cited_arguments_pkey'),
    UniqueConstraint('verdict_id', 'argument_id', name='debates_verdict_cited_ar_verdict_id_argument_id_a924670b_uniq'),
    Index('debates_verdict_cited_arguments_argument_id_19f8cee6', 'argument_id'),
    Index('debates_verdict_cited_arguments_verdict_id_1b627db4', 'verdict_id')
)
